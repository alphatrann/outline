import { CollectionPermission } from "@shared/types";
import { UserMembership } from "@server/models";
import {
  buildAdmin,
  buildCollection,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import { cleanBetweenTests } from "@server/test/cleanup";
import { getTestServer } from "@server/test/support";

const server = getTestServer();
cleanBetweenTests();

describe("#collections.permissions", () => {
  it("should grant access only to users added to a private collection", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const allowed = await buildUser({ teamId: team.id });
    const denied = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      permission: null,
    });

    const addRes = await server.post("/api/collections.add_user", admin, {
      body: {
        id: collection.id,
        userId: allowed.id,
        permission: CollectionPermission.Read,
      },
    });
    const addBody = await addRes.json();
    expect(addRes.status).toEqual(200);
    expect(addBody.data.memberships).toContainEqual(
      expect.objectContaining({
        userId: allowed.id,
        permission: CollectionPermission.Read,
      })
    );

    const allowedMembership = await UserMembership.findOne({
      where: { collectionId: collection.id, userId: allowed.id },
    });
    expect(allowedMembership).not.toBeNull();
    expect(allowedMembership?.permission).toEqual(CollectionPermission.Read);

    const deniedMembership = await UserMembership.findOne({
      where: { collectionId: collection.id, userId: denied.id },
    });
    expect(deniedMembership).toBeNull();

    const allowedInfo = await server.post("/api/collections.info", allowed, {
      body: { id: collection.id },
    });
    expect(allowedInfo.status).toEqual(200);

    const deniedInfo = await server.post("/api/collections.info", denied, {
      body: { id: collection.id },
    });
    expect(deniedInfo.status).toEqual(403);
  });
});
