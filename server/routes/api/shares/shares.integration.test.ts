import { Share } from "@server/models";
import {
  buildAdmin,
  buildDocument,
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
