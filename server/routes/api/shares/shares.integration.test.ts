import { Share } from "@server/models";
import {
  buildAdmin,
  buildCollection,
  buildDocument,
  buildShare,
  buildGuestUser,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import { cleanBetweenTests } from "@server/test/cleanup";
import { getTestServer } from "@server/test/support";

const server = getTestServer();
cleanBetweenTests();

describe("#shares (integration)", () => {
  it("should create a published share and revoke it, invalidating public access", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const document = await buildDocument({
      teamId: team.id,
      userId: user.id,
      title: "Shareable document",
      text: "Content to be shared",
    });

    // Create a published share on the document.
    const createRes = await server.post("/api/shares.create", user, {
      body: {
        documentId: document.id,
        published: true,
      },
    });
    const createBody = await createRes.json();

    expect(createRes.status).toEqual(200);
    expect(createBody.data.id).toBeDefined();
    expect(createBody.data.published).toEqual(true);

    // DB row: share exists with revokedAt null.
    const share = await Share.findByPk(createBody.data.id, {
      rejectOnEmpty: true,
    });
    expect(share.published).toEqual(true);
    expect(share.revokedAt).toBeNull();

    // Revoke the share.
    const revokeRes = await server.post("/api/shares.revoke", user, {
      body: {
        id: share.id,
      },
    });
    const revokeBody = await revokeRes.json();

    expect(revokeRes.status).toEqual(200);
    expect(revokeBody.success).toEqual(true);

    // DB row: share now has revokedAt set.
    const revoked = await Share.findByPk(share.id, {
      rejectOnEmpty: true,
    });
    expect(revoked.revokedAt).not.toBeNull();

    // Public document access via the share is invalidated after revocation.
    const infoAfterRevoke = await server.post("/api/documents.info", {
      body: { id: document.id, shareId: share.id },
    });
    expect(infoAfterRevoke.status).toEqual(404);
  });

  it("should deny guests permission to create a share", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const guest = await buildGuestUser({ teamId: team.id });
    const document = await buildDocument({
      teamId: team.id,
      userId: admin.id,
      title: "Guest document",
      text: "Guest should not share",
    });

    // A guest user cannot create a share — the createShare policy denies it.
    const res = await server.post("/api/shares.create", guest, {
      body: {
        documentId: document.id,
        published: true,
      },
    });

    expect(res.status).toEqual(403);

    // No share row was created for the guest.
    const count = await Share.count({
      where: { teamId: team.id, userId: guest.id },
    });
    expect(count).toEqual(0);
  });
});

describe("#shares edge cases (integration)", () => {
  async function setup() {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const document = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Secret title",
    });
    return { team, user, collection, document };
  }

  const publicInfo = (id: string, shareId: string) =>
    server.post("/api/documents.info", { body: { id, shareId } });

  it("should not serve an unpublished share", async () => {
    const { team, user, document } = await setup();
    const share = await buildShare({
      teamId: team.id,
      userId: user.id,
      documentId: document.id,
      published: false,
    });

    const res = await publicInfo(document.id, share.id);
    expect(res.status).toEqual(404);
    expect(JSON.stringify(await res.json())).not.toContain("Secret title");
  });

  it("should not serve a share of an archived document", async () => {
    const { team, user, document } = await setup();
    const share = await buildShare({
      teamId: team.id,
      userId: user.id,
      documentId: document.id,
    });
    await document.update({ archivedAt: new Date() });

    const res = await publicInfo(document.id, share.id);
    expect(res.status).toEqual(404);
  });

  it("should not serve shares of a suspended team", async () => {
    const { team, user, document } = await setup();
    const share = await buildShare({
      teamId: team.id,
      userId: user.id,
      documentId: document.id,
    });
    await team.update({ suspendedAt: new Date() });

    const res = await publicInfo(document.id, share.id);
    expect(res.status).toEqual(404);
  });

  it("should refuse to create or serve shares when the collection disallows sharing", async () => {
    const { team, user, collection, document } = await setup();
    const share = await buildShare({
      teamId: team.id,
      userId: user.id,
      documentId: document.id,
    });
    await collection.update({ sharing: false });

    const served = await publicInfo(document.id, share.id);
    expect(served.status).toEqual(403);

    const before = await Share.count({ where: { teamId: team.id } });
    const created = await server.post("/api/shares.create", user, {
      body: { documentId: document.id, published: true },
    });
    expect(created.status).toEqual(403);
    expect(await Share.count({ where: { teamId: team.id } })).toEqual(before);
  });

  it("should not expose a document outside the shared subtree", async () => {
    const { team, user, collection, document } = await setup();
    const outside = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Outside the share",
    });
    const share = await buildShare({
      teamId: team.id,
      userId: user.id,
      documentId: document.id,
      includeChildDocuments: true,
    });

    const res = await publicInfo(outside.id, share.id);
    expect([403, 404]).toContain(res.status);
    expect(JSON.stringify(await res.json())).not.toContain("Outside the share");
  });

  it("should stop serving a share after it is unpublished", async () => {
    const { team, user, document } = await setup();
    const share = await buildShare({
      teamId: team.id,
      userId: user.id,
      documentId: document.id,
    });
    expect((await publicInfo(document.id, share.id)).status).toEqual(200);

    const upd = await server.post("/api/shares.update", user, {
      body: { id: share.id, published: false },
    });
    expect(upd.status).toEqual(200);
    expect((await publicInfo(document.id, share.id)).status).toEqual(404);
  });
});
