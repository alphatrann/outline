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

describe("#shares cross-team (integration)", () => {
  it("should not let another team's member share a document", async () => {
    const teamA = await buildTeam();
    const teamB = await buildTeam();
    const userA = await buildUser({ teamId: teamA.id });
    const userB = await buildUser({ teamId: teamB.id });
    const collection = await buildCollection({
      teamId: teamA.id,
      userId: userA.id,
    });
    const document = await buildDocument({
      teamId: teamA.id,
      userId: userA.id,
      collectionId: collection.id,
    });

    const res = await server.post("/api/shares.create", userB, {
      body: { documentId: document.id, published: true },
    });

    expect([403, 404]).toContain(res.status);
    expect(await Share.count({ where: { documentId: document.id } })).toEqual(
      0
    );
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

describe("#shares.info public (integration)", () => {
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
      title: "Public doc",
    });
    return { team, user, collection, document };
  }

  it("should return a published document share to an anonymous viewer", async () => {
    const { team, user, document } = await setup();
    const share = await buildShare({
      teamId: team.id,
      userId: user.id,
      documentId: document.id,
      showLastUpdated: false,
    });

    const res = await server.post("/api/shares.info", {
      body: { id: share.id, documentId: document.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.shares).toHaveLength(1);
    expect(body.data.shares[0].id).toEqual(share.id);
    expect(body.data.shares[0].documentId).toEqual(document.id);
    // Anonymous viewers do not see who created the share or admin fields.
    expect(body.data.shares[0].createdBy).toBeUndefined();
    expect(body.data.shares[0].lastAccessedAt).toBeUndefined();
    expect(body.data.document.id).toEqual(document.id);
    expect(body.data.document.title).toEqual("Public doc");
    expect(body.data.document.updatedAt).toBeUndefined();
    expect(body.data.collection).toBeNull();
    expect(body.data.sharedTree).toBeDefined();
    expect(body.policies).toHaveLength(1);
    expect(body.policies[0].id).toEqual(share.id);
  });

  it("should include updatedAt when the share shows last updated", async () => {
    const { team, user, document } = await setup();
    const share = await buildShare({
      teamId: team.id,
      userId: user.id,
      documentId: document.id,
      showLastUpdated: true,
    });

    const res = await server.post("/api/shares.info", {
      body: { id: share.id, documentId: document.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.document.updatedAt).toBeDefined();
  });

  it("should return a collection share with the collection presented", async () => {
    const { team, user, collection } = await setup();
    const share = await buildShare({
      teamId: team.id,
      userId: user.id,
      documentId: null,
      collectionId: collection.id,
    });

    const res = await server.post("/api/shares.info", {
      body: { id: share.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.collection.id).toEqual(collection.id);
    expect(body.data.document).toBeNull();
    expect(body.data.shares[0].collectionId).toEqual(collection.id);
  });

  it("should only expose team branding when public branding is enabled", async () => {
    const { team, user, document } = await setup();
    const share = await buildShare({
      teamId: team.id,
      userId: user.id,
      documentId: document.id,
    });

    await team.update({
      preferences: { ...team.preferences, publicBranding: false },
    });
    const hidden = await (
      await server.post("/api/shares.info", {
        body: { id: share.id, documentId: document.id },
      })
    ).json();
    expect(hidden.data.team.name).toBeUndefined();
    expect(hidden.data.team.tocPosition).toBeDefined();

    await team.update({
      preferences: { ...team.preferences, publicBranding: true },
    });
    const shown = await (
      await server.post("/api/shares.info", {
        body: { id: share.id, documentId: document.id },
      })
    ).json();
    expect(shown.data.team.name).toEqual(team.name);
  });

  it("should present member-level detail to an authenticated member", async () => {
    const { team, user, collection, document } = await setup();
    const share = await buildShare({
      teamId: team.id,
      userId: user.id,
      documentId: document.id,
    });
    const collectionShare = await buildShare({
      teamId: team.id,
      userId: user.id,
      documentId: null,
      collectionId: collection.id,
    });

    const res = await server.post("/api/shares.info", user, {
      body: { id: share.id, documentId: document.id },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.shares[0].createdBy.id).toEqual(user.id);
    expect(body.data.document.id).toEqual(document.id);
    expect(body.data.document.text).toBeDefined();

    const colRes = await server.post("/api/shares.info", user, {
      body: { id: collectionShare.id },
    });
    const colBody = await colRes.json();
    expect(colRes.status).toEqual(200);
    expect(colBody.data.collection.id).toEqual(collection.id);
    expect(colBody.data.document).toBeNull();
  });

  it("should reveal lastAccessedAt only to admins", async () => {
    const { team, user, document } = await setup();
    const admin = await buildAdmin({ teamId: team.id });
    const share = await buildShare({
      teamId: team.id,
      userId: user.id,
      documentId: document.id,
      lastAccessedAt: new Date(),
    });

    const asAdmin = await (
      await server.post("/api/shares.info", admin, {
        body: { id: share.id, documentId: document.id },
      })
    ).json();
    expect(asAdmin.data.shares[0]).toHaveProperty("lastAccessedAt");

    const asUser = await (
      await server.post("/api/shares.info", user, {
        body: { id: share.id, documentId: document.id },
      })
    ).json();
    expect(asUser.data.shares[0]).not.toHaveProperty("lastAccessedAt");
  });
});

describe("#shares.create / update / revoke (integration)", () => {
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
    });
    return { team, user, collection, document };
  }

  it("should create a share for a collection and persist flags", async () => {
    const { user, collection } = await setup();
    const res = await server.post("/api/shares.create", user, {
      body: {
        collectionId: collection.id,
        published: true,
        allowIndexing: false,
        allowSubscriptions: false,
        showLastUpdated: true,
        showTOC: true,
        urlId: "my-collection-share",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.collectionId).toEqual(collection.id);
    expect(body.data.documentId).toBeNull();
    expect(body.data.includeChildDocuments).toEqual(true);
    expect(body.data.urlId).toEqual("my-collection-share");
    const share = await Share.findByPk(body.data.id, { rejectOnEmpty: true });
    expect(share.allowIndexing).toEqual(false);
    expect(share.allowSubscriptions).toEqual(false);
    expect(share.showLastUpdated).toEqual(true);
    expect(share.showTOC).toEqual(true);
    expect(share.urlId).toEqual("my-collection-share");
    expect(body.policies).toHaveLength(1);
  });

  it("should be idempotent for the same source", async () => {
    const { user, document } = await setup();
    const first = await (
      await server.post("/api/shares.create", user, {
        body: { documentId: document.id },
      })
    ).json();
    const second = await (
      await server.post("/api/shares.create", user, {
        body: { documentId: document.id },
      })
    ).json();
    expect(second.data.id).toEqual(first.data.id);
  });

  it("should 404 for a missing document or collection", async () => {
    const { user } = await setup();
    const missing = "7c4f2a8e-6b1d-4f3a-9c5e-1a2b3c4d5e6f";

    const docRes = await server.post("/api/shares.create", user, {
      body: { documentId: missing },
    });
    expect(docRes.status).toEqual(404);

    const colRes = await server.post("/api/shares.create", user, {
      body: { collectionId: missing },
    });
    expect(colRes.status).toEqual(404);
  });

  it("should deny sharing a collection the user cannot read", async () => {
    const { team, user } = await setup();
    const other = await buildUser({ teamId: team.id });
    const privateCollection = await buildCollection({
      teamId: team.id,
      userId: other.id,
      permission: null,
    });

    const res = await server.post("/api/shares.create", user, {
      body: { collectionId: privateCollection.id },
    });
    expect([403, 404]).toContain(res.status);
    expect(
      await Share.count({ where: { collectionId: privateCollection.id } })
    ).toEqual(0);
  });

  it("should deny publishing a share when the collection disallows sharing", async () => {
    const { user, collection } = await setup();
    await collection.update({ sharing: false });

    const res = await server.post("/api/shares.create", user, {
      body: { collectionId: collection.id, published: true },
    });
    expect(res.status).toEqual(403);
  });

  it("should update every share field", async () => {
    const { team, user, document } = await setup();
    const share = await buildShare({
      teamId: team.id,
      userId: user.id,
      documentId: document.id,
      published: false,
      includeChildDocuments: false,
      allowIndexing: true,
      allowSubscriptions: true,
      showLastUpdated: false,
      showTOC: false,
    });

    const res = await server.post("/api/shares.update", user, {
      body: {
        id: share.id,
        published: true,
        allowIndexing: false,
        allowSubscriptions: false,
        showLastUpdated: true,
        showTOC: true,
        urlId: "custom-url-id",
        title: "Custom title",
        iconUrl: "https://example.com/icon.png",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.title).toEqual("Custom title");
    expect(body.policies).toHaveLength(1);
    const updated = await Share.findByPk(share.id, { rejectOnEmpty: true });
    expect(updated.published).toEqual(true);
    // Publishing implies child documents are included.
    expect(updated.includeChildDocuments).toEqual(true);
    expect(updated.allowIndexing).toEqual(false);
    expect(updated.allowSubscriptions).toEqual(false);
    expect(updated.showLastUpdated).toEqual(true);
    expect(updated.showTOC).toEqual(true);
    expect(updated.urlId).toEqual("custom-url-id");
    expect(updated.title).toEqual("Custom title");
    expect(updated.iconUrl).toEqual("https://example.com/icon.png");
  });

  it("should toggle each flag back to false and clear title and icon", async () => {
    const { team, user, document } = await setup();
    const share = await buildShare({
      teamId: team.id,
      userId: user.id,
      documentId: document.id,
      includeChildDocuments: true,
      allowIndexing: true,
      allowSubscriptions: true,
      showLastUpdated: true,
      showTOC: true,
      title: "Old title",
      iconUrl: "https://example.com/old.png",
    });

    const res = await server.post("/api/shares.update", user, {
      body: {
        id: share.id,
        includeChildDocuments: false,
        allowIndexing: false,
        allowSubscriptions: false,
        showLastUpdated: false,
        showTOC: false,
        title: "",
        iconUrl: null,
      },
    });
    expect(res.status).toEqual(200);

    const updated = await Share.findByPk(share.id, { rejectOnEmpty: true });
    expect(updated.includeChildDocuments).toEqual(false);
    expect(updated.allowIndexing).toEqual(false);
    expect(updated.allowSubscriptions).toEqual(false);
    expect(updated.showLastUpdated).toEqual(false);
    expect(updated.showTOC).toEqual(false);
    expect(updated.title).toBeNull();
    expect(updated.iconUrl).toBeNull();
  });

  it("should leave fields untouched when they are not sent", async () => {
    const { team, user, document } = await setup();
    const share = await buildShare({
      teamId: team.id,
      userId: user.id,
      documentId: document.id,
      allowIndexing: false,
      showTOC: true,
      title: "Keep me",
      iconUrl: "https://example.com/keep.png",
      urlId: "keep-me",
    });

    const res = await server.post("/api/shares.update", user, {
      body: { id: share.id, allowSubscriptions: false },
    });
    expect(res.status).toEqual(200);

    const updated = await Share.findByPk(share.id, { rejectOnEmpty: true });
    expect(updated.allowIndexing).toEqual(false);
    expect(updated.showTOC).toEqual(true);
    expect(updated.title).toEqual("Keep me");
    expect(updated.iconUrl).toEqual("https://example.com/keep.png");
    expect(updated.urlId).toEqual("keep-me");
  });

  it("should 404 when revoking a share with no source", async () => {
    const { team, user, document } = await setup();
    const share = await buildShare({
      teamId: team.id,
      userId: user.id,
      documentId: document.id,
    });
    await document.destroy();

    const res = await server.post("/api/shares.revoke", user, {
      body: { id: share.id },
    });
    expect(res.status).toEqual(404);
    const after = await Share.findByPk(share.id, { rejectOnEmpty: true });
    expect(after.revokedAt).toBeNull();
  });
});

describe("#shares.sitemap (integration)", () => {
  it("should list the shared document url for an indexable share", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const share = await buildShare({
      teamId: team.id,
      userId: user.id,
      documentId: null,
      collectionId: collection.id,
      allowIndexing: true,
    });

    const res = await server.get(`/api/shares.sitemap?id=${share.id}`);
    const text = await res.text();

    expect(res.status).toEqual(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    expect(text).toContain("<urlset");
    expect(text).toContain(`/s/${share.id}`);
    expect(text).toContain("<loc>");
  });

  it("should 404 with an empty body when indexing is disallowed", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const document = await buildDocument({ teamId: team.id, userId: user.id });
    const share = await buildShare({
      teamId: team.id,
      userId: user.id,
      documentId: document.id,
      allowIndexing: false,
    });

    const res = await server.get(`/api/shares.sitemap?id=${share.id}`);
    expect(res.status).toEqual(404);
    expect(await res.text()).not.toContain("<urlset");
  });
});
