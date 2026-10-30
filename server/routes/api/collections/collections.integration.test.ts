import { CollectionPermission } from "@shared/types";
import { UserMembership } from "@server/models";
import {
  buildAdmin,
  buildCollection,
  buildGroup,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import { cleanBetweenTests } from "@server/test/cleanup";
import { getTestServer } from "@server/test/support";

const server = getTestServer();
cleanBetweenTests();

describe("#collections.permissions", () => {
  it('should verify document permission boundary for Read vs ReadWrite membership', async () => {
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

    const readDoc = await server.post('/api/documents.create', readUser, {
      body: {
        id: crypto.randomUUID(),
        collectionId: collection.id,
        title: `Doc-${readUser.id}-${Date.now()}`,
        content: [{ type: "paragraph", content: [{ type: "text", text: "Test" }] }],
      }
    })
    // A Read member cannot create a document in a private collection;
    // only ReadWrite or Admin membership allows document creation.
    expect(readDoc.status).toEqual(403)

    const readWriteDoc = await server.post('/api/documents.create', readWriteUser, {
      body: {
        id: crypto.randomUUID(),
        collectionId: collection.id,
        title: `Doc-${readWriteUser.id}-${Date.now()}`,
        content: [{ type: "paragraph", content: [{ type: "text", text: "Test" }] }],
      }
    })

    expect(readWriteDoc.status).toEqual(200)
  })

  it('read and read_write cannot update collection', async () => {
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
    const updateResRead = await server.post('/api/collections.update', allowedRead, {
      body: {
        id: collection.id,
        name: "Edited Collection"
      }
    })
    expect(updateResRead.status).toEqual(403)

    const updateResReadWrite = await server.post('/api/collections.update', allowedReadWrite, {
      body: {
        id: collection.id,
        name: "Edited Collection"
      }
    })
    expect(updateResReadWrite.status).toEqual(403)

    // User with Admin permission can update the collection
    const adminUpdateRes = await server.post('/api/collections.update', admin, {
      body: {
        id: collection.id,
        name: "Edited Collection"
      }
    })
    expect(adminUpdateRes.status).toEqual(200)
  })

  it('should default user permission to defaultCollectionPermission when adding user', async () => {
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
  })

  it('should allow membership listing for authorized users', async () => {
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
    const adminMemberships = await server.post("/api/collections.memberships", admin, {
      body: { id: collection.id },
    });
    expect(adminMemberships.status).toEqual(200);

    // Allowed user can see memberships
    const allowedMemberships = await server.post("/api/collections.memberships", allowed, {
      body: { id: collection.id },
    });
    expect(allowedMemberships.status).toEqual(200);

    // Denied user (not added to collection) cannot see memberships
    const denied = await buildUser({ teamId: team.id });
    const deniedMemberships = await server.post("/api/collections.memberships", denied, {
      body: { id: collection.id },
    });
    expect(deniedMemberships.status).toEqual(403);
  })

  it('should update collection privacy and affect access', async () => {
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
    await server.post('/api/collections.update', admin, {
      body: {
        id: collection.id,
        permission: null,
      }
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
  })

  it('should revoke user access after double remove_user call', async () => {
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
        userId: allowed.id
      },
    });

    // User should no longer have access
    const noLongerAllowed = await server.post("/api/collections.info", allowed, {
      body: { id: collection.id },
    });
    expect(noLongerAllowed.status).toEqual(403);

    // Second remove should handle gracefully - may return 200, 400, or 404 depending on implementation
    const doubleRemove = await server.post("/api/collections.remove_user", admin, {
      body: {
        id: collection.id,
        userId: allowed.id
      },
    });
    // May return 200, 400, or 404 depending on implementation
    expect([200, 400, 404]).toContain(doubleRemove.status);
  })

  it('should update permission when re-adding a member with a different level', async () => {
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
    const readDoc = await server.post('/api/documents.create', user, {
      body: {
        id: crypto.randomUUID(),
        collectionId: collection.id,
        title: "Read doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Test" }] }],
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
    const readWriteDoc = await server.post('/api/documents.create', user, {
      body: {
        id: crypto.randomUUID(),
        collectionId: collection.id,
        title: "ReadWrite doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Test" }] }],
      },
    });
    expect(readWriteDoc.status).toEqual(200);
  })

  it('should allow info access via group membership', async () => {
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
    const groupUserInfo = await server.post("/api/collections.info", groupUser, {
      body: { id: collection.id },
    });
    expect(groupUserInfo.status).toEqual(200);

    // Non-member cannot access collection info
    const nonMemberInfo = await server.post("/api/collections.info", nonMember, {
      body: { id: collection.id },
    });
    expect(nonMemberInfo.status).toEqual(403);
  })
});
