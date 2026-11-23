import { CollectionPermission, UserRole } from "@shared/types";
import {
  Collection,
  GroupMembership,
  Share,
  UserMembership,
} from "@server/models";
import type { User } from "@server/models";
import { cleanBetweenTests } from "@server/test/cleanup";
import {
  buildAdmin,
  buildCollection,
  buildDocument,
  buildGroup,
  buildGroupUser,
  buildShare,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import { serialize } from "./index";

cleanBetweenTests();

/**
 * Pins every decision of server/policies/collection.ts and share.ts. Each
 * scenario lists the abilities that must be granted per user; every other
 * ability must be denied, so a changed condition fails at least one scenario.
 */
interface World {
  team: Awaited<ReturnType<typeof buildTeam>>;
  owner: User;
  creator: User;
  member: User;
  viewer: User;
  guest: User;
  admin: User;
  stranger: User;
}

async function buildWorld(
  teamOverrides: Parameters<typeof buildTeam>[0] = {}
): Promise<World> {
  const team = await buildTeam(teamOverrides);
  const other = await buildTeam();
  return {
    team,
    owner: await buildUser({ teamId: team.id }),
    creator: await buildUser({ teamId: team.id }),
    member: await buildUser({ teamId: team.id }),
    viewer: await buildUser({ teamId: team.id, role: UserRole.Viewer }),
    guest: await buildUser({ teamId: team.id, role: UserRole.Guest }),
    admin: await buildAdmin({ teamId: team.id }),
    stranger: await buildUser({ teamId: other.id }),
  };
}

type Case = [string, User, () => Promise<object | null>];
type Build = (w: World) => Promise<Case[]>;

const everyone = (w: World): Array<[string, User]> => [
  ["creator", w.creator],
  ["member", w.member],
  ["viewer", w.viewer],
  ["guest", w.guest],
  ["admin", w.admin],
  ["stranger", w.stranger],
];

const loadCollection = (user: User, id: string) => () =>
  Collection.findByPk(id, { userId: user.id, paranoid: false });

const forCollection = (w: World, id: string, only?: string[]): Case[] =>
  everyone(w)
    .filter(([who]) => !only || only.includes(who))
    .map(([who, user]) => [who, user, loadCollection(user, id)]);

const memberOf = (
  userId: string,
  collectionId: string,
  permission: CollectionPermission
) =>
  UserMembership.create({
    userId,
    collectionId,
    permission,
    createdById: userId,
  });

const make = (w: World, overrides: Record<string, unknown> = {}) =>
  buildCollection({
    teamId: w.team.id,
    userId: w.owner.id,
    ...overrides,
  });

const scenarios: Array<[string, Build]> = [
  [
    "ReadWrite collection",
    async (w) =>
      forCollection(
        w,
        (await make(w, { permission: CollectionPermission.ReadWrite })).id
      ),
  ],
  [
    "Read collection",
    async (w) =>
      forCollection(
        w,
        (await make(w, { permission: CollectionPermission.Read })).id
      ),
  ],
  [
    "private collection",
    async (w) => forCollection(w, (await make(w, { permission: null })).id),
  ],
  [
    "private collection with sharing off",
    async (w) =>
      forCollection(
        w,
        (await make(w, { permission: null, sharing: false })).id
      ),
  ],
  [
    "ReadWrite collection with sharing off",
    async (w) =>
      forCollection(
        w,
        (
          await make(w, {
            permission: CollectionPermission.ReadWrite,
            sharing: false,
          })
        ).id
      ),
  ],
  [
    "Read collection with sharing off",
    async (w) =>
      forCollection(
        w,
        (
          await make(w, {
            permission: CollectionPermission.Read,
            sharing: false,
          })
        ).id
      ),
  ],
  [
    "private collection with user memberships",
    async (w) => {
      const c = await make(w, { permission: null });
      await memberOf(w.member.id, c.id, CollectionPermission.Read);
      await memberOf(w.viewer.id, c.id, CollectionPermission.ReadWrite);
      await memberOf(w.guest.id, c.id, CollectionPermission.Admin);
      await memberOf(w.creator.id, c.id, CollectionPermission.ReadWrite);
      return forCollection(w, c.id);
    },
  ],
  [
    "private collection with Admin and ReadWrite members",
    async (w) => {
      const c = await make(w, { permission: null });
      await memberOf(w.member.id, c.id, CollectionPermission.Admin);
      await memberOf(w.viewer.id, c.id, CollectionPermission.Admin);
      await memberOf(w.creator.id, c.id, CollectionPermission.ReadWrite);
      await memberOf(w.guest.id, c.id, CollectionPermission.Read);
      return forCollection(w, c.id);
    },
  ],
  [
    "private collection with group membership",
    async (w) => {
      const c = await make(w, { permission: null });
      const g = await buildGroup({ teamId: w.team.id });
      await buildGroupUser({ groupId: g.id, userId: w.member.id });
      await GroupMembership.create({
        groupId: g.id,
        collectionId: c.id,
        permission: CollectionPermission.ReadWrite,
        createdById: w.owner.id,
      });
      return forCollection(w, c.id, ["member", "creator"]);
    },
  ],
  [
    "Read collection with ReadWrite members",
    async (w) => {
      const c = await make(w, { permission: CollectionPermission.Read });
      await memberOf(w.member.id, c.id, CollectionPermission.ReadWrite);
      await memberOf(w.viewer.id, c.id, CollectionPermission.ReadWrite);
      await memberOf(w.guest.id, c.id, CollectionPermission.ReadWrite);
      return forCollection(w, c.id);
    },
  ],
  [
    "templateManagement ReadWrite on a ReadWrite collection",
    async (w) =>
      forCollection(
        w,
        (
          await make(w, {
            permission: CollectionPermission.ReadWrite,
            templateManagement: CollectionPermission.ReadWrite,
          })
        ).id
      ),
  ],
  [
    "templateManagement ReadWrite on a private collection with members",
    async (w) => {
      const c = await make(w, {
        permission: null,
        templateManagement: CollectionPermission.ReadWrite,
      });
      await memberOf(w.member.id, c.id, CollectionPermission.ReadWrite);
      await memberOf(w.viewer.id, c.id, CollectionPermission.ReadWrite);
      await memberOf(w.guest.id, c.id, CollectionPermission.ReadWrite);
      await memberOf(w.creator.id, c.id, CollectionPermission.Read);
      return forCollection(w, c.id);
    },
  ],
  [
    "templateManagement Admin on a ReadWrite collection",
    async (w) =>
      forCollection(
        w,
        (
          await make(w, {
            permission: CollectionPermission.ReadWrite,
            templateManagement: CollectionPermission.Admin,
          })
        ).id
      ),
  ],
  [
    "archived collection",
    async (w) => {
      const c = await make(w, {
        permission: CollectionPermission.ReadWrite,
        archivedAt: new Date(),
      });
      await memberOf(w.member.id, c.id, CollectionPermission.Admin);
      return forCollection(w, c.id);
    },
  ],
  [
    "deleted collection",
    async (w) => {
      const c = await make(w, { permission: CollectionPermission.ReadWrite });
      await memberOf(w.member.id, c.id, CollectionPermission.Admin);
      await make(w);
      await Collection.unscoped().update(
        { deletedAt: new Date() },
        { where: { id: c.id }, paranoid: false, hooks: false }
      );
      return forCollection(w, c.id);
    },
  ],
  [
    "deleted archived collection",
    async (w) => {
      const c = await make(w, {
        permission: CollectionPermission.ReadWrite,
        archivedAt: new Date(),
      });
      await make(w);
      await Collection.unscoped().update(
        { deletedAt: new Date() },
        { where: { id: c.id }, paranoid: false, hooks: false }
      );
      return forCollection(w, c.id, ["admin", "member"]);
    },
  ],
];

const sorted = (names: string[]) => [...names].sort();

async function granted(user: User, load: () => Promise<object | null>) {
  const target = await load();
  return Object.entries(serialize(user, target as never))
    .filter(([, value]) => !!value)
    .map(([name]) => name)
    .sort();
}

const expected: Record<string, Record<string, string[]>> = {
  "ReadWrite collection": {
    creator: [
      "createDocument",
      "deleteDocument",
      "download",
      "duplicate",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
    member: [
      "createDocument",
      "deleteDocument",
      "download",
      "duplicate",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
    viewer: [
      "download",
      "read",
      "readDocument",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    guest: [],
    admin: [
      "archive",
      "createDocument",
      "createTemplate",
      "delete",
      "deleteDocument",
      "download",
      "duplicate",
      "export",
      "manageTemplate",
      "move",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
      "updateDocument",
    ],
    stranger: [],
  },
  "Read collection": {
    creator: [
      "download",
      "duplicate",
      "read",
      "readDocument",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    member: [
      "download",
      "duplicate",
      "read",
      "readDocument",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    viewer: [
      "download",
      "read",
      "readDocument",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    guest: [],
    admin: [
      "archive",
      "createTemplate",
      "delete",
      "download",
      "duplicate",
      "export",
      "manageTemplate",
      "move",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
    ],
    stranger: [],
  },
  "private collection": {
    creator: [],
    member: [],
    viewer: [],
    guest: [],
    admin: [
      "archive",
      "createTemplate",
      "delete",
      "download",
      "duplicate",
      "export",
      "manageTemplate",
      "move",
      "read",
      "update",
    ],
    stranger: [],
  },
  "private collection with sharing off": {
    creator: [],
    member: [],
    viewer: [],
    guest: [],
    admin: [
      "archive",
      "createTemplate",
      "delete",
      "download",
      "duplicate",
      "export",
      "manageTemplate",
      "move",
      "read",
      "update",
    ],
    stranger: [],
  },
  "ReadWrite collection with sharing off": {
    creator: [
      "createDocument",
      "deleteDocument",
      "download",
      "duplicate",
      "read",
      "readDocument",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
    member: [
      "createDocument",
      "deleteDocument",
      "download",
      "duplicate",
      "read",
      "readDocument",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
    viewer: [
      "download",
      "read",
      "readDocument",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    guest: [],
    admin: [
      "archive",
      "createDocument",
      "createTemplate",
      "delete",
      "deleteDocument",
      "download",
      "duplicate",
      "export",
      "manageTemplate",
      "move",
      "read",
      "readDocument",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
      "updateDocument",
    ],
    stranger: [],
  },
  "Read collection with sharing off": {
    creator: [
      "download",
      "duplicate",
      "read",
      "readDocument",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    member: [
      "download",
      "duplicate",
      "read",
      "readDocument",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    viewer: [
      "download",
      "read",
      "readDocument",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    guest: [],
    admin: [
      "archive",
      "createTemplate",
      "delete",
      "download",
      "duplicate",
      "export",
      "manageTemplate",
      "move",
      "read",
      "readDocument",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
    ],
    stranger: [],
  },
  "private collection with user memberships": {
    creator: [
      "createDocument",
      "deleteDocument",
      "download",
      "duplicate",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
    member: [
      "download",
      "duplicate",
      "read",
      "readDocument",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    viewer: [
      "createDocument",
      "deleteDocument",
      "download",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
    guest: [
      "archive",
      "createDocument",
      "createTemplate",
      "delete",
      "deleteDocument",
      "download",
      "export",
      "manageTemplate",
      "read",
      "readDocument",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
      "updateDocument",
    ],
    admin: [
      "archive",
      "createTemplate",
      "delete",
      "download",
      "duplicate",
      "export",
      "manageTemplate",
      "move",
      "read",
      "update",
    ],
    stranger: [],
  },
  "private collection with Admin and ReadWrite members": {
    creator: [
      "createDocument",
      "deleteDocument",
      "download",
      "duplicate",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
    member: [
      "archive",
      "createDocument",
      "createTemplate",
      "delete",
      "deleteDocument",
      "download",
      "duplicate",
      "export",
      "manageTemplate",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
      "updateDocument",
    ],
    viewer: [
      "archive",
      "createDocument",
      "createTemplate",
      "delete",
      "deleteDocument",
      "download",
      "export",
      "manageTemplate",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
      "updateDocument",
    ],
    guest: [
      "download",
      "read",
      "readDocument",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    admin: [
      "archive",
      "createTemplate",
      "delete",
      "download",
      "duplicate",
      "export",
      "manageTemplate",
      "move",
      "read",
      "update",
    ],
    stranger: [],
  },
  "private collection with group membership": {
    creator: [],
    member: [
      "createDocument",
      "deleteDocument",
      "download",
      "duplicate",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
  },
  "Read collection with ReadWrite members": {
    creator: [
      "download",
      "duplicate",
      "read",
      "readDocument",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    member: [
      "createDocument",
      "deleteDocument",
      "download",
      "duplicate",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
    viewer: [
      "createDocument",
      "deleteDocument",
      "download",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
    guest: [
      "createDocument",
      "deleteDocument",
      "download",
      "read",
      "readDocument",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
    admin: [
      "archive",
      "createTemplate",
      "delete",
      "download",
      "duplicate",
      "export",
      "manageTemplate",
      "move",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
    ],
    stranger: [],
  },
  "templateManagement ReadWrite on a ReadWrite collection": {
    creator: [
      "createDocument",
      "createTemplate",
      "deleteDocument",
      "download",
      "duplicate",
      "manageTemplate",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
    member: [
      "createDocument",
      "createTemplate",
      "deleteDocument",
      "download",
      "duplicate",
      "manageTemplate",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
    viewer: [
      "download",
      "read",
      "readDocument",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    guest: [],
    admin: [
      "archive",
      "createDocument",
      "createTemplate",
      "delete",
      "deleteDocument",
      "download",
      "duplicate",
      "export",
      "manageTemplate",
      "move",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
      "updateDocument",
    ],
    stranger: [],
  },
  "templateManagement ReadWrite on a private collection with members": {
    creator: [
      "download",
      "duplicate",
      "read",
      "readDocument",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    member: [
      "createDocument",
      "createTemplate",
      "deleteDocument",
      "download",
      "duplicate",
      "manageTemplate",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
    viewer: [
      "createDocument",
      "createTemplate",
      "deleteDocument",
      "download",
      "manageTemplate",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
    guest: [
      "createDocument",
      "deleteDocument",
      "download",
      "read",
      "readDocument",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
    admin: [
      "archive",
      "createTemplate",
      "delete",
      "download",
      "duplicate",
      "export",
      "manageTemplate",
      "move",
      "read",
      "update",
    ],
    stranger: [],
  },
  "templateManagement Admin on a ReadWrite collection": {
    creator: [
      "createDocument",
      "deleteDocument",
      "download",
      "duplicate",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
    member: [
      "createDocument",
      "deleteDocument",
      "download",
      "duplicate",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
    viewer: [
      "download",
      "read",
      "readDocument",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    guest: [],
    admin: [
      "archive",
      "createDocument",
      "createTemplate",
      "delete",
      "deleteDocument",
      "download",
      "duplicate",
      "export",
      "manageTemplate",
      "move",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
      "updateDocument",
    ],
    stranger: [],
  },
  "archived collection": {
    creator: [
      "download",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
    member: [
      "delete",
      "download",
      "read",
      "readDocument",
      "restore",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDeprecatedReason",
      "updateDocument",
    ],
    viewer: [
      "download",
      "read",
      "readDocument",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    guest: [],
    admin: [
      "delete",
      "download",
      "read",
      "readDocument",
      "restore",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDeprecatedReason",
      "updateDocument",
    ],
    stranger: [],
  },
  "deleted collection": {
    creator: [
      "download",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
    member: [
      "download",
      "read",
      "readDocument",
      "restore",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
    viewer: [
      "download",
      "read",
      "readDocument",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    guest: [],
    admin: [
      "download",
      "read",
      "readDocument",
      "restore",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
    stranger: [],
  },
  "deleted archived collection": {
    member: [
      "download",
      "read",
      "readDocument",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
    admin: [
      "download",
      "read",
      "readDocument",
      "restore",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDocument",
    ],
  },
};

describe("collection policy matrix", () => {
  for (const [label, build] of scenarios) {
    it(`grants exactly the expected abilities: ${label}`, async () => {
      const w = await buildWorld();
      const cases = await build(w);
      expect(cases.map(([who]) => who).sort()).toEqual(
        Object.keys(expected[label]).sort()
      );
      for (const [who, user, load] of cases) {
        expect([who, await granted(user, load)]).toEqual([
          who,
          sorted(expected[label][who]),
        ]);
      }
    });
  }
});

describe("team and share policy", () => {
  const can = (user: User, target: object, action: string) =>
    !!serialize(user, target as never)[action];

  it("lets only admins and (by default) members create collections, only admins import", async () => {
    const w = await buildWorld();
    for (const [who, user] of everyone(w)) {
      const create = who === "creator" || who === "member" || who === "admin";
      expect([who, can(user, w.team, "createCollection")]).toEqual([
        who,
        create,
      ]);
      expect([who, can(user, w.team, "importCollection")]).toEqual([
        who,
        who === "admin",
      ]);
    }

    const locked = await buildWorld({ memberCollectionCreate: false });
    for (const [who, user] of everyone(locked)) {
      expect([who, can(user, locked.team, "createCollection")]).toEqual([
        who,
        who === "admin",
      ]);
    }
  });

  it("lets everyone but guests and strangers create and list shares", async () => {
    const w = await buildWorld();
    for (const [who, user] of everyone(w)) {
      const allowed = !["guest", "stranger"].includes(who);
      expect([who, can(user, w.team, "createShare")]).toEqual([who, allowed]);
      expect([who, can(user, w.team, "listShares")]).toEqual([who, allowed]);
    }
  });

  const shareScenarios: Array<
    [string, (w: World) => Promise<string>, Record<string, string[]>]
  > = [
    [
      "document in a ReadWrite collection",
      async (w) => {
        const c = await make(w, { permission: CollectionPermission.ReadWrite });
        const d = await buildDocument({
          teamId: w.team.id,
          userId: w.owner.id,
          collectionId: c.id,
        });
        return (
          await buildShare({
            teamId: w.team.id,
            userId: w.creator.id,
            documentId: d.id,
          })
        ).id;
      },
      {
        creator: ["read", "update", "revoke"],
        member: ["read", "update"],
        viewer: ["read"],
        guest: [],
        admin: ["read", "update", "revoke"],
        stranger: [],
      },
    ],
    [
      "collection share in a ReadWrite collection",
      async (w) => {
        const c = await make(w, { permission: CollectionPermission.ReadWrite });
        return (
          await buildShare({
            teamId: w.team.id,
            userId: w.creator.id,
            collectionId: c.id,
          })
        ).id;
      },
      {
        creator: ["read", "update", "revoke"],
        member: ["read", "update"],
        viewer: ["read"],
        guest: [],
        admin: ["read", "update", "revoke"],
        stranger: [],
      },
    ],
    [
      "document in a Read collection",
      async (w) => {
        const c = await make(w, { permission: CollectionPermission.Read });
        const d = await buildDocument({
          teamId: w.team.id,
          userId: w.owner.id,
          collectionId: c.id,
        });
        return (
          await buildShare({
            teamId: w.team.id,
            userId: w.creator.id,
            documentId: d.id,
          })
        ).id;
      },
      {
        creator: ["read", "revoke"],
        member: ["read"],
        viewer: ["read"],
        guest: [],
        admin: ["read", "update", "revoke"],
        stranger: [],
      },
    ],
    [
      "document in a collection with sharing off",
      async (w) => {
        const c = await make(w, {
          permission: CollectionPermission.ReadWrite,
          sharing: false,
        });
        const d = await buildDocument({
          teamId: w.team.id,
          userId: w.owner.id,
          collectionId: c.id,
        });
        return (
          await buildShare({
            teamId: w.team.id,
            userId: w.creator.id,
            documentId: d.id,
          })
        ).id;
      },
      {
        creator: ["read", "revoke"],
        member: ["read"],
        viewer: ["read"],
        guest: [],
        admin: ["read", "revoke"],
        stranger: [],
      },
    ],
  ];

  for (const [label, build, expectedByWho] of shareScenarios) {
    it(`grants share abilities: ${label}`, async () => {
      const w = await buildWorld();
      const shareId = await build(w);
      for (const [who, user] of everyone(w)) {
        const share = await Share.scope({
          method: ["withCollectionPermissions", user.id],
        }).findByPk(shareId);
        const abilities = Object.entries(serialize(user, share))
          .filter(([, value]) => !!value)
          .map(([name]) => name)
          .sort();
        expect([who, abilities]).toEqual([who, sorted(expectedByWho[who])]);
      }
    });
  }
});
