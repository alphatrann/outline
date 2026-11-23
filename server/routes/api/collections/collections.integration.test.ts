import { CollectionPermission } from "@shared/types";
import {
  Collection,
  Document,
  Event,
  GroupMembership,
  Import,
  Share,
  Team,
  UserMembership,
} from "@server/models";
import {
  buildAdmin,
  buildAttachment,
  buildCollection,
  buildDocument,
  buildGroup,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import { cleanBetweenTests } from "@server/test/cleanup";
import { getTestServer } from "@server/test/support";

const server = getTestServer();
cleanBetweenTests();

describe("#collections.permissions", () => {
  it("should verify document permission boundary for Read vs ReadWrite membership", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const readUser = await buildUser({ teamId: team.id });
    const readWriteUser = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      permission: null,
    });

    await server.post("/api/collections.add_user", admin, {
      body: {
        id: collection.id,
        userId: readUser.id,
        permission: CollectionPermission.Read,
      },
    });

    await server.post("/api/collections.add_user", admin, {
      body: {
        id: collection.id,
        userId: readWriteUser.id,
        permission: CollectionPermission.ReadWrite,
      },
    });

    const readDoc = await server.post("/api/documents.create", readUser, {
      body: {
        id: crypto.randomUUID(),
        collectionId: collection.id,
        title: `Doc-${readUser.id}-${Date.now()}`,
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Test" }] },
        ],
      },
    });
    // A Read member cannot create a document in a private collection;
    // only ReadWrite or Admin membership allows document creation.
    expect(readDoc.status).toEqual(403);

    const readWriteDoc = await server.post(
      "/api/documents.create",
      readWriteUser,
      {
        body: {
          id: crypto.randomUUID(),
          collectionId: collection.id,
          title: `Doc-${readWriteUser.id}-${Date.now()}`,
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Test" }] },
          ],
        },
      }
    );

    expect(readWriteDoc.status).toEqual(200);
  });

  it("read and read_write cannot update collection", async () => {
    /*
     * The collection "update" operation requires Admin membership
     * for BOTH Read and ReadWrite members. This test demonstrates the
     * permission boundary: neither Read nor ReadWrite can update collection
     * metadata (name, description, etc.) - only admins can. Both return 403.
     *
     * To see where ReadWrite DOES enable something Read cannot, test
     * document operations where ReadWrite membership is required.
     */
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const allowedRead = await buildUser({ teamId: team.id });
    const allowedReadWrite = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      permission: null,
    });

    // Add user with Read permission
    await server.post("/api/collections.add_user", admin, {
      body: {
        id: collection.id,
        userId: allowedRead.id,
        permission: CollectionPermission.Read,
      },
    });

    // Add user with ReadWrite permission
    await server.post("/api/collections.add_user", admin, {
      body: {
        id: collection.id,
        userId: allowedReadWrite.id,
        permission: CollectionPermission.ReadWrite,
      },
    });

    // Neither Read nor ReadWrite can update collection metadata -
    // only Admin can. Both should return 403.
    const updateResRead = await server.post(
      "/api/collections.update",
      allowedRead,
      {
        body: {
          id: collection.id,
          name: "Edited Collection",
        },
      }
    );
    expect(updateResRead.status).toEqual(403);

    const updateResReadWrite = await server.post(
      "/api/collections.update",
      allowedReadWrite,
      {
        body: {
          id: collection.id,
          name: "Edited Collection",
        },
      }
    );
    expect(updateResReadWrite.status).toEqual(403);

    // User with Admin permission can update the collection
    const adminUpdateRes = await server.post("/api/collections.update", admin, {
      body: {
        id: collection.id,
        name: "Edited Collection",
      },
    });
    expect(adminUpdateRes.status).toEqual(200);
  });

  it("should default user permission to defaultCollectionPermission when adding user", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const allowed = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      permission: null,
    });

    // Add user without specifying permission - should default to user's defaultCollectionPermission
    const addRes = await server.post("/api/collections.add_user", admin, {
      body: {
        id: collection.id,
        userId: allowed.id,
        // no permission specified
      },
    });

    const addBody = await addRes.json();
    expect(addRes.status).toEqual(200);
    // The membership permission should default to the user's defaultCollectionPermission
    expect(addBody.data.memberships).toContainEqual(
      expect.objectContaining({
        userId: allowed.id,
        permission: allowed.defaultCollectionPermission,
      })
    );
  });

  it("should allow membership listing for authorized users", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const allowed = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      permission: null,
    });

    // Add allowed user with Read permission
    await server.post("/api/collections.add_user", admin, {
      body: {
        id: collection.id,
        userId: allowed.id,
        permission: CollectionPermission.Read,
      },
    });

    // Admin can see all memberships
    const adminMemberships = await server.post(
      "/api/collections.memberships",
      admin,
      {
        body: { id: collection.id },
      }
    );
    expect(adminMemberships.status).toEqual(200);

    // Allowed user can see memberships
    const allowedMemberships = await server.post(
      "/api/collections.memberships",
      allowed,
      {
        body: { id: collection.id },
      }
    );
    expect(allowedMemberships.status).toEqual(200);

    // Denied user (not added to collection) cannot see memberships
    const denied = await buildUser({ teamId: team.id });
    const deniedMemberships = await server.post(
      "/api/collections.memberships",
      denied,
      {
        body: { id: collection.id },
      }
    );
    expect(deniedMemberships.status).toEqual(403);
  });

  it("should update collection privacy and affect access", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const allowed = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      permission: null,
    });

    // Add allowed user with Read permission
    await server.post("/api/collections.add_user", admin, {
      body: {
        id: collection.id,
        userId: allowed.id,
        permission: CollectionPermission.Read,
      },
    });

    // Initially, allowed user can access info
    let allowedInfo = await server.post("/api/collections.info", allowed, {
      body: { id: collection.id },
    });
    expect(allowedInfo.status).toEqual(200);

    // Admin changes collection permission to null (keeps it private)
    await server.post("/api/collections.update", admin, {
      body: {
        id: collection.id,
        permission: null,
      },
    });

    // Allowed user should still have access (has Read membership) even though private
    allowedInfo = await server.post("/api/collections.info", allowed, {
      body: { id: collection.id },
    });
    expect(allowedInfo.status).toEqual(200);

    // New user without membership should be denied (collection is private)
    const newUser = await buildUser({ teamId: team.id });
    const newUserInfo = await server.post("/api/collections.info", newUser, {
      body: { id: collection.id },
    });
    expect(newUserInfo.status).toEqual(403);
  });

  it("should revoke user access after double remove_user call", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const allowed = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      permission: null,
    });

    // Add user with Read permission
    await server.post("/api/collections.add_user", admin, {
      body: {
        id: collection.id,
        userId: allowed.id,
        permission: CollectionPermission.Read,
      },
    });

    // First remove should succeed
    await server.post("/api/collections.remove_user", admin, {
      body: {
        id: collection.id,
        userId: allowed.id,
      },
    });

    // User should no longer have access
    const noLongerAllowed = await server.post(
      "/api/collections.info",
      allowed,
      {
        body: { id: collection.id },
      }
    );
    expect(noLongerAllowed.status).toEqual(403);

    // Second remove should handle gracefully - may return 200, 400, or 404 depending on implementation
    const doubleRemove = await server.post(
      "/api/collections.remove_user",
      admin,
      {
        body: {
          id: collection.id,
          userId: allowed.id,
        },
      }
    );
    // May return 200, 400, or 404 depending on implementation
    expect([200, 400, 404]).toContain(doubleRemove.status);
  });

  it("should update permission when re-adding a member with a different level", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      permission: null,
    });

    // Add user with Read permission
    await server.post("/api/collections.add_user", admin, {
      body: {
        id: collection.id,
        userId: user.id,
        permission: CollectionPermission.Read,
      },
    });

    // Read member can access info
    const readInfo = await server.post("/api/collections.info", user, {
      body: { id: collection.id },
    });
    expect(readInfo.status).toEqual(200);

    // Read member cannot create a document in the collection
    const readDoc = await server.post("/api/documents.create", user, {
      body: {
        id: crypto.randomUUID(),
        collectionId: collection.id,
        title: "Read doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Test" }] },
        ],
      },
    });
    expect(readDoc.status).toEqual(403);

    // Re-add user with ReadWrite permission - should update the stored membership
    const readdRes = await server.post("/api/collections.add_user", admin, {
      body: {
        id: collection.id,
        userId: user.id,
        permission: CollectionPermission.ReadWrite,
      },
    });
    expect(readdRes.status).toEqual(200);

    const readdBody = await readdRes.json();
    expect(readdBody.data.memberships).toContainEqual(
      expect.objectContaining({
        userId: user.id,
        permission: CollectionPermission.ReadWrite,
      })
    );

    // ReadWrite member can now create a document in the collection
    const readWriteDoc = await server.post("/api/documents.create", user, {
      body: {
        id: crypto.randomUUID(),
        collectionId: collection.id,
        title: "ReadWrite doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Test" }] },
        ],
      },
    });
    expect(readWriteDoc.status).toEqual(200);
  });

  it("should allow info access via group membership", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const groupUser = await buildUser({ teamId: team.id });
    const nonMember = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      permission: null,
    });

    // Create a group and add the user to it
    const group = await buildGroup({ teamId: team.id });
    await group.$add("user", groupUser, { through: { createdById: admin.id } });

    // Add group to collection with Read permission
    await collection.$add("group", group, {
      through: { permission: CollectionPermission.Read, createdById: admin.id },
    });

    // Group member can access collection info
    const groupUserInfo = await server.post(
      "/api/collections.info",
      groupUser,
      {
        body: { id: collection.id },
      }
    );
    expect(groupUserInfo.status).toEqual(200);

    // Non-member cannot access collection info
    const nonMemberInfo = await server.post(
      "/api/collections.info",
      nonMember,
      {
        body: { id: collection.id },
      }
    );
    expect(nonMemberInfo.status).toEqual(403);
  });

  /**
   * Scenario: group access revoked.
   * Given a private collection shared with a group (Read) and a group member,
   * when the group is removed from the collection, then the member gets 403.
   */
  it("should revoke access when the group is removed from the collection", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const groupUser = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      permission: null,
    });
    const group = await buildGroup({ teamId: team.id });
    await group.$add("user", groupUser, { through: { createdById: admin.id } });
    await collection.$add("group", group, {
      through: { permission: CollectionPermission.Read, createdById: admin.id },
    });

    const before = await server.post("/api/collections.info", groupUser, {
      body: { id: collection.id },
    });
    expect(before.status).toEqual(200);

    const removeRes = await server.post(
      "/api/collections.remove_group",
      admin,
      {
        body: { id: collection.id, groupId: group.id },
      }
    );
    expect(removeRes.status).toEqual(200);

    const after = await server.post("/api/collections.info", groupUser, {
      body: { id: collection.id },
    });
    expect(after.status).toEqual(403);
  });

  /**
   * Scenario: direct membership removed but group membership remains.
   * Given a user with direct ReadWrite and group Read access, when the direct
   * membership is removed, then the user keeps access through the group.
   */
  it("should keep group access after direct membership is removed", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      permission: null,
    });
    const group = await buildGroup({ teamId: team.id });
    await group.$add("user", user, { through: { createdById: admin.id } });
    await collection.$add("group", group, {
      through: { permission: CollectionPermission.Read, createdById: admin.id },
    });
    await server.post("/api/collections.add_user", admin, {
      body: {
        id: collection.id,
        userId: user.id,
        permission: CollectionPermission.ReadWrite,
      },
    });

    const removeRes = await server.post("/api/collections.remove_user", admin, {
      body: { id: collection.id, userId: user.id },
    });
    expect(removeRes.status).toEqual(200);

    const info = await server.post("/api/collections.info", user, {
      body: { id: collection.id },
    });
    expect(info.status).toEqual(200);
  });
});

describe("cross-team isolation (integration)", () => {
  async function setup() {
    const teamA = await buildTeam();
    const teamB = await buildTeam();
    const userA = await buildUser({ teamId: teamA.id });
    const userB = await buildUser({ teamId: teamB.id });
    const collectionA = await buildCollection({
      teamId: teamA.id,
      userId: userA.id,
    });
    const docA = await buildDocument({
      teamId: teamA.id,
      userId: userA.id,
      collectionId: collectionA.id,
      title: "Team A confidential",
      text: "zebracrossing secret",
    });
    return { teamA, teamB, userA, userB, collectionA, docA };
  }

  const denied = (status: number) => expect([403, 404]).toContain(status);

  it("should not let another team read a document", async () => {
    const { userB, docA } = await setup();
    const res = await server.post("/api/documents.info", userB, {
      body: { id: docA.id },
    });
    denied(res.status);
    expect(JSON.stringify(await res.json())).not.toContain("confidential");
  });

  it("should not leak another team's rows through list, search or collections", async () => {
    const { userB, docA, collectionA } = await setup();
    const list = await server.post("/api/documents.list", userB, { body: {} });
    const search = await server.post("/api/documents.search", userB, {
      body: { query: "zebracrossing" },
    });
    const cols = await server.post("/api/collections.list", userB, {
      body: {},
    });

    expect(JSON.stringify((await list.json()).data)).not.toContain(docA.id);
    expect((await search.json()).data).toEqual([]);
    expect(JSON.stringify((await cols.json()).data)).not.toContain(
      collectionA.id
    );
  });

  it("should not let another team read a collection, even an open one", async () => {
    const teamA = await buildTeam();
    const teamB = await buildTeam();
    const userA = await buildUser({ teamId: teamA.id });
    const userB = await buildUser({ teamId: teamB.id });
    const open = await buildCollection({
      teamId: teamA.id,
      userId: userA.id,
      name: "Team A open collection",
      permission: CollectionPermission.ReadWrite,
    });

    const res = await server.post("/api/collections.info", userB, {
      body: { id: open.id },
    });
    denied(res.status);
    expect(JSON.stringify(await res.json())).not.toContain("open collection");
  });

  it("should not let another team update, move or delete a document", async () => {
    const { userB, docA, collectionA } = await setup();
    const statuses = [
      (
        await server.post("/api/documents.update", userB, {
          body: { id: docA.id, title: "Hacked" },
        })
      ).status,
      (
        await server.post("/api/documents.move", userB, {
          body: { id: docA.id, collectionId: collectionA.id },
        })
      ).status,
      (
        await server.post("/api/documents.delete", userB, {
          body: { id: docA.id },
        })
      ).status,
    ];
    statuses.forEach(denied);

    const row = await Document.findByPk(docA.id, { rejectOnEmpty: true });
    expect(row.title).toEqual("Team A confidential");
    expect(row.deletedAt).toBeNull();
  });

  it("should not let a team nest its document under another team's parent", async () => {
    const { userB, teamB, docA, collectionA } = await setup();
    const collectionB = await buildCollection({
      teamId: teamB.id,
      userId: userB.id,
    });
    const docB = await buildDocument({
      teamId: teamB.id,
      userId: userB.id,
      collectionId: collectionB.id,
    });

    const res = await server.post("/api/documents.move", userB, {
      body: { id: docB.id, parentDocumentId: docA.id },
    });
    denied(res.status);

    const row = await Document.findByPk(docB.id, { rejectOnEmpty: true });
    expect(row.collectionId).toEqual(collectionB.id);
    const reloaded = await Collection.findByPk(collectionA.id, {
      includeDocumentStructure: true,
      rejectOnEmpty: true,
    });
    expect(JSON.stringify(reloaded.documentStructure)).not.toContain(docB.id);
  });

  it("should not let another team share a document", async () => {
    const { userB, teamA, docA } = await setup();
    const res = await server.post("/api/shares.create", userB, {
      body: { documentId: docA.id, published: true },
    });
    denied(res.status);
    expect(await Share.count({ where: { teamId: teamA.id } })).toEqual(0);
  });

  it("should not add a user from another team to a collection", async () => {
    const { userA, userB, collectionA } = await setup();
    const res = await server.post("/api/collections.add_user", userA, {
      body: {
        id: collectionA.id,
        userId: userB.id,
        permission: CollectionPermission.Read,
      },
    });
    denied(res.status);
    expect(
      await UserMembership.count({
        where: { collectionId: collectionA.id, userId: userB.id },
      })
    ).toEqual(0);
  });
});

describe("#collections.documents (integration)", () => {
  it("should return the document structure for a reader", async () => {
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
      title: "Structure doc",
    });

    const res = await server.post("/api/collections.documents", user, {
      body: { id: collection.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toEqual(document.id);
    expect(body.data[0].title).toEqual("Structure doc");
  });

  it("should return an empty array for an empty collection", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });

    const res = await server.post("/api/collections.documents", user, {
      body: { id: collection.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data).toEqual([]);
  });

  it("should deny a user without access to a private collection", async () => {
    const team = await buildTeam();
    const owner = await buildUser({ teamId: team.id });
    const outsider = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: owner.id,
      permission: null,
    });
    await buildDocument({
      teamId: team.id,
      userId: owner.id,
      collectionId: collection.id,
      title: "Private structure",
    });

    const res = await server.post("/api/collections.documents", outsider, {
      body: { id: collection.id },
    });

    expect(res.status).toEqual(403);
    expect(JSON.stringify(await res.json())).not.toContain("Private structure");
  });
});

describe("#collections.import (integration)", () => {
  it("should create an import from an attachment", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const attachment = await buildAttachment({
      teamId: team.id,
      userId: admin.id,
    });

    const res = await server.post("/api/collections.import", admin, {
      body: {
        attachmentId: attachment.id,
        permission: CollectionPermission.Read,
        format: "outline-markdown",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.success).toEqual(true);

    const imports = await Import.findAll({ where: { teamId: team.id } });
    expect(imports).toHaveLength(1);
    expect(imports[0].service).toEqual("markdown");
    expect(imports[0].state).toEqual("created");
    expect(imports[0].name).toEqual(attachment.name);
    expect(imports[0].createdById).toEqual(admin.id);
    expect(imports[0].integrationId).toBeNull();
    expect(imports[0].input).toHaveLength(1);
    expect(imports[0].input[0].permission).toEqual(CollectionPermission.Read);
    expect(imports[0].input[0].externalId).toBeTruthy();
  });

  it("should keep long names and the storage key of the attachment", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const longName = `${"a".repeat(60)}.zip`;
    const attachment = await buildAttachment(
      { teamId: team.id, userId: admin.id },
      longName
    );

    const res = await server.post("/api/collections.import", admin, {
      body: { attachmentId: attachment.id },
    });
    expect(res.status).toEqual(200);

    const [imported] = await Import.findAll({ where: { teamId: team.id } });
    expect(imported.name).toEqual(longName);
    expect(imported.scratch).toEqual({ storageKey: attachment.key });
  });

  it("should default to the JSON service without a permission", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const attachment = await buildAttachment({
      teamId: team.id,
      userId: admin.id,
    });

    const res = await server.post("/api/collections.import", admin, {
      body: { attachmentId: attachment.id },
    });
    expect(res.status).toEqual(200);

    const [imported] = await Import.findAll({ where: { teamId: team.id } });
    expect(imported.service).toEqual("json");
    expect(imported.input[0].permission).toBeUndefined();
  });

  it("should deny non-admins from importing", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const attachment = await buildAttachment({
      teamId: team.id,
      userId: user.id,
    });

    const res = await server.post("/api/collections.import", user, {
      body: { attachmentId: attachment.id },
    });

    expect(res.status).toEqual(403);
    expect(await Import.count({ where: { teamId: team.id } })).toEqual(0);
  });

  it("should deny importing another team's attachment", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const foreign = await buildAttachment();

    const res = await server.post("/api/collections.import", admin, {
      body: { attachmentId: foreign.id },
    });

    expect([403, 404]).toContain(res.status);
    expect(await Import.count({ where: { teamId: team.id } })).toEqual(0);
  });
});

describe("#collections group memberships (integration)", () => {
  async function setup() {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      permission: null,
    });
    const group = await buildGroup({ teamId: team.id, userId: admin.id });
    return { team, admin, collection, group };
  }

  it("should add a group and then update its permission in place", async () => {
    const { admin, collection, group } = await setup();

    const created = await server.post("/api/collections.add_group", admin, {
      body: {
        id: collection.id,
        groupId: group.id,
        permission: CollectionPermission.Read,
      },
    });
    const createdBody = await created.json();
    expect(created.status).toEqual(200);
    expect(createdBody.data.groupMemberships).toHaveLength(1);
    expect(createdBody.data.groupMemberships[0].permission).toEqual(
      CollectionPermission.Read
    );
    expect(createdBody.data.groupMemberships[0].groupId).toEqual(group.id);

    const updated = await server.post("/api/collections.add_group", admin, {
      body: {
        id: collection.id,
        groupId: group.id,
        permission: CollectionPermission.ReadWrite,
      },
    });
    expect(updated.status).toEqual(200);

    const rows = await GroupMembership.findAll({
      where: { collectionId: collection.id, groupId: group.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].permission).toEqual(CollectionPermission.ReadWrite);
    expect(rows[0].createdById).toEqual(admin.id);
  });

  it("should deny adding a group without update access", async () => {
    const { team, collection, group } = await setup();
    const member = await buildUser({ teamId: team.id });

    const res = await server.post("/api/collections.add_group", member, {
      body: { id: collection.id, groupId: group.id },
    });

    expect(res.status).toEqual(403);
    expect(
      await GroupMembership.count({ where: { collectionId: collection.id } })
    ).toEqual(0);
  });

  it("should remove a group and reject removing one that is not a member", async () => {
    const { team, admin, collection, group } = await setup();
    await server.post("/api/collections.add_group", admin, {
      body: { id: collection.id, groupId: group.id },
    });

    const removed = await server.post("/api/collections.remove_group", admin, {
      body: { id: collection.id, groupId: group.id },
    });
    expect(removed.status).toEqual(200);
    expect((await removed.json()).success).toEqual(true);
    expect(
      await GroupMembership.count({ where: { collectionId: collection.id } })
    ).toEqual(0);

    const other = await buildGroup({ teamId: team.id, userId: admin.id });
    const missing = await server.post("/api/collections.remove_group", admin, {
      body: { id: collection.id, groupId: other.id },
    });
    expect(missing.status).toEqual(400);
    expect((await missing.json()).message).toEqual(
      "This Group is not a part of the collection"
    );
  });

  it("should filter group memberships by query and permission", async () => {
    const { team, admin, collection, group } = await setup();
    await group.update({ name: "Alpha Engineers" });
    const second = await buildGroup({
      teamId: team.id,
      userId: admin.id,
      name: "Beta Designers",
    });
    await server.post("/api/collections.add_group", admin, {
      body: {
        id: collection.id,
        groupId: group.id,
        permission: CollectionPermission.Read,
      },
    });
    await server.post("/api/collections.add_group", admin, {
      body: {
        id: collection.id,
        groupId: second.id,
        permission: CollectionPermission.ReadWrite,
      },
    });

    const all = await (
      await server.post("/api/collections.group_memberships", admin, {
        body: { id: collection.id },
      })
    ).json();
    expect(all.pagination.total).toEqual(2);
    expect(all.data.groups).toHaveLength(2);

    const byQuery = await (
      await server.post("/api/collections.group_memberships", admin, {
        body: { id: collection.id, query: "engineers" },
      })
    ).json();
    expect(byQuery.pagination.total).toEqual(1);
    expect(byQuery.data.groups[0].id).toEqual(group.id);

    const byPermission = await (
      await server.post("/api/collections.group_memberships", admin, {
        body: { id: collection.id, permission: CollectionPermission.ReadWrite },
      })
    ).json();
    expect(byPermission.pagination.total).toEqual(1);
    expect(byPermission.data.groups[0].id).toEqual(second.id);
    expect(byPermission.data.groupMemberships[0].permission).toEqual(
      CollectionPermission.ReadWrite
    );
  });

  it("should deny listing group memberships of a private collection", async () => {
    const { team, collection } = await setup();
    const outsider = await buildUser({ teamId: team.id });

    const res = await server.post(
      "/api/collections.group_memberships",
      outsider,
      { body: { id: collection.id } }
    );
    expect(res.status).toEqual(403);
  });
});

describe("#collections.memberships filters (integration)", () => {
  it("should filter user memberships by query and permission", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const alice = await buildUser({ teamId: team.id, name: "Alice Walker" });
    const bob = await buildUser({ teamId: team.id, name: "Bob Stone" });
    const collection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      permission: null,
    });
    await server.post("/api/collections.add_user", admin, {
      body: {
        id: collection.id,
        userId: alice.id,
        permission: CollectionPermission.Read,
      },
    });
    await server.post("/api/collections.add_user", admin, {
      body: {
        id: collection.id,
        userId: bob.id,
        permission: CollectionPermission.ReadWrite,
      },
    });

    const byQuery = await (
      await server.post("/api/collections.memberships", admin, {
        body: { id: collection.id, query: "alice" },
      })
    ).json();
    expect(byQuery.data.users).toHaveLength(1);
    expect(byQuery.data.users[0].id).toEqual(alice.id);

    const byPermission = await (
      await server.post("/api/collections.memberships", admin, {
        body: { id: collection.id, permission: CollectionPermission.ReadWrite },
      })
    ).json();
    expect(byPermission.data.users).toHaveLength(1);
    expect(byPermission.data.users[0].id).toEqual(bob.id);
    expect(byPermission.data.memberships[0].permission).toEqual(
      CollectionPermission.ReadWrite
    );
  });
});

describe("#collections.update fields (integration)", () => {
  async function setup() {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
    });
    return { team, admin, collection };
  }

  it("should update content, icon and color", async () => {
    const { admin, collection } = await setup();
    const data = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
      ],
    };

    const res = await server.post("/api/collections.update", admin, {
      body: {
        id: collection.id,
        data,
        icon: "🚀",
        color: "#123456",
      },
    });
    expect(res.status).toEqual(200);

    const updated = await Collection.findByPk(collection.id, {
      rejectOnEmpty: true,
    });
    expect(updated.content).toEqual(data);
    expect(updated.icon).toEqual("🚀");
    expect(updated.color).toEqual("#123456");
  });

  it("should update the description", async () => {
    const { admin, collection } = await setup();

    const res = await server.post("/api/collections.update", admin, {
      body: { id: collection.id, description: "A new description" },
    });
    expect(res.status).toEqual(200);

    const updated = await Collection.findByPk(collection.id, {
      rejectOnEmpty: true,
    });
    expect(updated.description).toContain("A new description");
  });

  it("should leave fields untouched when they are not sent", async () => {
    const { admin, collection } = await setup();
    await collection.update({ icon: "🚀", color: "#123456" });
    const before = await Collection.findByPk(collection.id, {
      rejectOnEmpty: true,
    });

    const res = await server.post("/api/collections.update", admin, {
      body: { id: collection.id, name: "Renamed" },
    });
    expect(res.status).toEqual(200);

    const after = await Collection.findByPk(collection.id, {
      rejectOnEmpty: true,
    });
    expect(after.name).toEqual("Renamed");
    expect(after.icon).toEqual("🚀");
    expect(after.color).toEqual("#123456");
    expect(after.description).toEqual(before.description);
    expect(after.content).toEqual(before.content);
  });

  it("should give the actor an admin membership when removing default access", async () => {
    const { team, collection } = await setup();
    const editor = await buildAdmin({ teamId: team.id });
    await collection.update({ permission: CollectionPermission.ReadWrite });
    expect(
      await UserMembership.count({
        where: { collectionId: collection.id, userId: editor.id },
      })
    ).toEqual(0);

    const res = await server.post("/api/collections.update", editor, {
      body: { id: collection.id, permission: null },
    });
    expect(res.status).toEqual(200);

    const membership = await UserMembership.findOne({
      where: { collectionId: collection.id, userId: editor.id },
    });
    expect(membership?.permission).toEqual(CollectionPermission.Admin);
    expect(membership?.createdById).toEqual(editor.id);
    // The fallback membership is silent: no add_user event is published.
    expect(
      await Event.count({
        where: { name: "collections.add_user", collectionId: collection.id },
      })
    ).toEqual(0);
  });

  it("should not create a membership when default access stays read-write", async () => {
    const { team, collection } = await setup();
    const editor = await buildAdmin({ teamId: team.id });
    await collection.update({ permission: CollectionPermission.ReadWrite });

    const res = await server.post("/api/collections.update", editor, {
      body: { id: collection.id, permission: CollectionPermission.ReadWrite },
    });
    expect(res.status).toEqual(200);
    expect(
      await UserMembership.count({
        where: { collectionId: collection.id, userId: editor.id },
      })
    ).toEqual(0);
  });

  it("should not duplicate an existing membership when removing default access", async () => {
    const { team, collection } = await setup();
    const editor = await buildAdmin({ teamId: team.id });
    await collection.update({ permission: CollectionPermission.ReadWrite });
    await UserMembership.create({
      collectionId: collection.id,
      userId: editor.id,
      permission: CollectionPermission.ReadWrite,
      createdById: editor.id,
    });

    const res = await server.post("/api/collections.update", editor, {
      body: { id: collection.id, permission: null },
    });
    expect(res.status).toEqual(200);
    const rows = await UserMembership.findAll({
      where: { collectionId: collection.id, userId: editor.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].permission).toEqual(CollectionPermission.ReadWrite);
  });

  describe("deprecatedReason", () => {
    async function archived(reason: string | null = null) {
      const team = await buildTeam();
      const admin = await buildAdmin({ teamId: team.id });
      const collection = await buildCollection({
        teamId: team.id,
        userId: admin.id,
        archivedAt: new Date(),
        deprecatedReason: reason,
      });
      return { admin, collection };
    }

    it("should save a reason on an archived collection", async () => {
      const { admin, collection } = await archived();

      const res = await server.post("/api/collections.update", admin, {
        body: { id: collection.id, deprecatedReason: "  Replaced  " },
      });
      const body = await res.json();

      expect(res.status).toEqual(200);
      expect(body.data.deprecatedReason).toEqual("Replaced");
      expect(body.policies).toHaveLength(1);
      await collection.reload();
      expect(collection.deprecatedReason).toEqual("Replaced");
    });

    it("should clear the reason", async () => {
      const { admin, collection } = await archived("Outdated");

      const res = await server.post("/api/collections.update", admin, {
        body: { id: collection.id, deprecatedReason: null },
      });
      expect(res.status).toEqual(200);
      await collection.reload();
      expect(collection.deprecatedReason).toBeNull();
    });

    it("should refuse a reason mixed with other fields", async () => {
      const { admin, collection } = await archived();

      const res = await server.post("/api/collections.update", admin, {
        body: {
          id: collection.id,
          deprecatedReason: "Outdated",
          name: "Sneaky rename",
        },
      });
      expect(res.status).toEqual(403);
      await collection.reload();
      expect(collection.deprecatedReason).toBeNull();
      expect(collection.name).not.toEqual("Sneaky rename");
    });

    it("should refuse a reason on an active collection", async () => {
      const { admin, collection } = await archived();
      await collection.update({ archivedAt: null });

      const res = await server.post("/api/collections.update", admin, {
        body: { id: collection.id, deprecatedReason: "Outdated" },
      });
      expect(res.status).toEqual(403);
    });
  });
});

describe("#collections response and edge details (integration)", () => {
  async function setup() {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      permission: null,
    });
    return { team, admin, collection };
  }

  it("should return policies and archivedBy from collections.info", async () => {
    const { team, admin } = await setup();
    const archived = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      archivedAt: new Date(),
    });

    const body = await (
      await server.post("/api/collections.info", admin, {
        body: { id: archived.id },
      })
    ).json();

    expect(body.data.id).toEqual(archived.id);
    expect(body.policies).toHaveLength(1);
    expect(body.policies[0].id).toEqual(archived.id);
    expect(body.data.archivedBy.id).toEqual(admin.id);
  });

  it("should remove only the requested group", async () => {
    const { team, admin, collection } = await setup();
    const groupA = await buildGroup({ teamId: team.id, userId: admin.id });
    const groupB = await buildGroup({ teamId: team.id, userId: admin.id });
    for (const group of [groupA, groupB]) {
      await server.post("/api/collections.add_group", admin, {
        body: { id: collection.id, groupId: group.id },
      });
    }

    const res = await server.post("/api/collections.remove_group", admin, {
      body: { id: collection.id, groupId: groupB.id },
    });
    expect(res.status).toEqual(200);

    const rows = await GroupMembership.findAll({
      where: { collectionId: collection.id },
    });
    expect(rows.map((r) => r.groupId)).toEqual([groupA.id]);
  });

  it("should update an existing user membership instead of duplicating it", async () => {
    const { team, admin, collection } = await setup();
    const user = await buildUser({ teamId: team.id });

    const first = await (
      await server.post("/api/collections.add_user", admin, {
        body: {
          id: collection.id,
          userId: user.id,
          permission: CollectionPermission.ReadWrite,
        },
      })
    ).json();
    expect(first.data.users).toHaveLength(1);
    expect(first.data.users[0].id).toEqual(user.id);
    expect(first.data.memberships).toHaveLength(1);

    const second = await server.post("/api/collections.add_user", admin, {
      body: {
        id: collection.id,
        userId: user.id,
        permission: CollectionPermission.Read,
      },
    });
    expect(second.status).toEqual(200);

    const rows = await UserMembership.findAll({
      where: { collectionId: collection.id, userId: user.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].permission).toEqual(CollectionPermission.Read);

    // Without a permission the user's default is applied.
    const third = await server.post("/api/collections.add_user", admin, {
      body: { id: collection.id, userId: user.id },
    });
    expect(third.status).toEqual(200);
    await rows[0].reload();
    expect(rows[0].permission).toEqual(user.defaultCollectionPermission);
  });

  it("should reject removing a user who is not a member and report success otherwise", async () => {
    const { team, admin, collection } = await setup();
    const user = await buildUser({ teamId: team.id });

    const missing = await server.post("/api/collections.remove_user", admin, {
      body: { id: collection.id, userId: user.id },
    });
    expect(missing.status).toEqual(400);
    expect((await missing.json()).message).toEqual(
      "User is not a collection member"
    );

    await server.post("/api/collections.add_user", admin, {
      body: { id: collection.id, userId: user.id },
    });
    const removed = await server.post("/api/collections.remove_user", admin, {
      body: { id: collection.id, userId: user.id },
    });
    expect(removed.status).toEqual(200);
    expect((await removed.json()).success).toEqual(true);
  });

  it("should only list memberships of the requested collection", async () => {
    const { team, admin, collection } = await setup();
    const other = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      permission: null,
    });
    const inScope = await buildUser({ teamId: team.id });
    const outOfScope = await buildUser({ teamId: team.id });
    await server.post("/api/collections.add_user", admin, {
      body: { id: collection.id, userId: inScope.id },
    });
    await server.post("/api/collections.add_user", admin, {
      body: { id: other.id, userId: outOfScope.id },
    });

    const body = await (
      await server.post("/api/collections.memberships", admin, {
        body: { id: collection.id },
      })
    ).json();

    const ids = body.data.users.map((u: { id: string }) => u.id);
    expect(ids).toContain(inScope.id);
    expect(ids).not.toContain(outOfScope.id);
  });

  it("should update a collection when only the id is sent", async () => {
    const { admin, collection } = await setup();

    const res = await server.post("/api/collections.update", admin, {
      body: { id: collection.id },
    });

    expect(res.status).toEqual(200);
  });

  it("should trim the name", async () => {
    const { admin, collection } = await setup();

    const res = await server.post("/api/collections.update", admin, {
      body: { id: collection.id, name: "  Padded name  " },
    });
    expect(res.status).toEqual(200);
    await collection.reload();
    expect(collection.name).toEqual("Padded name");
  });

  it("should not add an admin membership when default access was not read-write", async () => {
    const { team, collection } = await setup();
    const editor = await buildAdmin({ teamId: team.id });
    await collection.update({ permission: CollectionPermission.Read });

    const res = await server.post("/api/collections.update", editor, {
      body: { id: collection.id, permission: null },
    });
    expect(res.status).toEqual(200);
    expect(
      await UserMembership.count({
        where: { collectionId: collection.id, userId: editor.id },
      })
    ).toEqual(0);
  });

  it("should keep the team's default collection when privacy and sharing are unchanged", async () => {
    const { team, admin, collection } = await setup();
    await Team.update(
      { defaultCollectionId: collection.id },
      { where: { id: team.id } }
    );

    const res = await server.post("/api/collections.update", admin, {
      body: { id: collection.id, name: "Renamed again" },
    });
    expect(res.status).toEqual(200);

    const reloaded = await Team.findByPk(team.id, { rejectOnEmpty: true });
    expect(reloaded.defaultCollectionId).toEqual(collection.id);
  });
});
