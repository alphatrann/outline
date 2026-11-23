import {
  CollectionPermission,
  CommentingAccess,
  DocumentPermission,
  TeamPreference,
  UserRole,
} from "@shared/types";
import {
  Document,
  GroupMembership,
  Revision,
  UserMembership,
} from "@server/models";
import type { User } from "@server/models";
import { cleanBetweenTests } from "@server/test/cleanup";
import {
  buildAdmin,
  buildCollection,
  buildDocument,
  buildDraftDocument,
  buildGroup,
  buildGroupUser,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import { serialize } from "./index";

cleanBetweenTests();

/**
 * Pins every decision of server/policies/document.ts. Each scenario lists the
 * abilities that must be granted; every other ability must be denied, so a
 * changed condition in the policy fails at least one scenario.
 */
interface World {
  team: Awaited<ReturnType<typeof buildTeam>>;
  creator: User;
  member: User;
  viewer: User;
  guest: User;
  admin: User;
  stranger: User;
}

async function buildWorld(
  preferences: Partial<Record<TeamPreference, unknown>> = {}
): Promise<World> {
  const team = await buildTeam();
  for (const [key, value] of Object.entries(preferences)) {
    team.setPreference(key as TeamPreference, value as never);
  }
  await team.save();
  const other = await buildTeam();
  return {
    team,
    creator: await buildUser({ teamId: team.id }),
    member: await buildUser({ teamId: team.id }),
    viewer: await buildUser({ teamId: team.id, role: UserRole.Viewer }),
    guest: await buildUser({ teamId: team.id, role: UserRole.Guest }),
    admin: await buildAdmin({ teamId: team.id }),
    stranger: await buildUser({ teamId: other.id }),
  };
}

/** Abilities granted to `user` on the document, sorted. */
async function granted(user: User, documentId: string) {
  const document = await Document.findByPk(documentId, {
    userId: user.id,
    paranoid: false,
  });
  const abilities = serialize(user, document);
  return Object.entries(abilities)
    .filter(([, value]) => !!value)
    .map(([name]) => name)
    .sort();
}

const sorted = (names: string[]) => [...names].sort();

type Build = (w: World) => Promise<Array<[string, User, string]>>;

const mem = (
  userId: string,
  documentId: string,
  permission: DocumentPermission
) =>
  UserMembership.create({
    userId,
    documentId,
    permission,
    createdById: userId,
  });

const scenarios: Array<
  [string, Build, Partial<Record<TeamPreference, unknown>>?]
> = [
  [
    "published in ReadWrite collection",
    async (w) => {
      const c = await buildCollection({
        teamId: w.team.id,
        userId: w.creator.id,
        permission: CollectionPermission.ReadWrite,
      });
      const d = await buildDocument({
        teamId: w.team.id,
        userId: w.creator.id,
        collectionId: c.id,
      });
      return [
        ["creator", w.creator, d.id],
        ["member", w.member, d.id],
        ["viewer", w.viewer, d.id],
        ["guest", w.guest, d.id],
        ["admin", w.admin, d.id],
        ["stranger", w.stranger, d.id],
      ];
    },
  ],
  [
    "published in Read collection",
    async (w) => {
      const c = await buildCollection({
        teamId: w.team.id,
        userId: w.creator.id,
        permission: CollectionPermission.Read,
      });
      const d = await buildDocument({
        teamId: w.team.id,
        userId: w.creator.id,
        collectionId: c.id,
      });
      return [
        ["creator", w.creator, d.id],
        ["member", w.member, d.id],
        ["viewer", w.viewer, d.id],
        ["guest", w.guest, d.id],
        ["admin", w.admin, d.id],
      ];
    },
  ],
  [
    "published in private collection, no membership",
    async (w) => {
      const c = await buildCollection({
        teamId: w.team.id,
        userId: w.creator.id,
        permission: null,
      });
      const d = await buildDocument({
        teamId: w.team.id,
        userId: w.creator.id,
        collectionId: c.id,
      });
      return [
        ["creator", w.creator, d.id],
        ["member", w.member, d.id],
        ["viewer", w.viewer, d.id],
        ["guest", w.guest, d.id],
        ["admin", w.admin, d.id],
      ];
    },
  ],
  [
    "private collection, document memberships",
    async (w) => {
      const c = await buildCollection({
        teamId: w.team.id,
        userId: w.admin.id,
        permission: null,
      });
      const d = await buildDocument({
        teamId: w.team.id,
        userId: w.admin.id,
        collectionId: c.id,
      });
      await mem(w.member.id, d.id, DocumentPermission.Read);
      await mem(w.guest.id, d.id, DocumentPermission.Read);
      const d2 = await buildDocument({
        teamId: w.team.id,
        userId: w.admin.id,
        collectionId: c.id,
      });
      await mem(w.member.id, d2.id, DocumentPermission.ReadWrite);
      await mem(w.guest.id, d2.id, DocumentPermission.ReadWrite);
      await mem(w.viewer.id, d2.id, DocumentPermission.ReadWrite);
      const d3 = await buildDocument({
        teamId: w.team.id,
        userId: w.admin.id,
        collectionId: c.id,
      });
      await mem(w.member.id, d3.id, DocumentPermission.Admin);
      await mem(w.guest.id, d3.id, DocumentPermission.Admin);
      return [
        ["member Read", w.member, d.id],
        ["guest Read", w.guest, d.id],
        ["member ReadWrite", w.member, d2.id],
        ["guest ReadWrite", w.guest, d2.id],
        ["viewer ReadWrite", w.viewer, d2.id],
        ["member Admin", w.member, d3.id],
        ["guest Admin", w.guest, d3.id],
      ];
    },
  ],
  [
    "private collection, group document membership",
    async (w) => {
      const c = await buildCollection({
        teamId: w.team.id,
        userId: w.admin.id,
        permission: null,
      });
      const g = await buildGroup({ teamId: w.team.id });
      await buildGroupUser({ groupId: g.id, userId: w.member.id });
      const d = await buildDocument({
        teamId: w.team.id,
        userId: w.admin.id,
        collectionId: c.id,
      });
      await GroupMembership.create({
        groupId: g.id,
        documentId: d.id,
        permission: DocumentPermission.ReadWrite,
        createdById: w.admin.id,
      });
      return [
        ["group member", w.member, d.id],
        ["non member", w.creator, d.id],
      ];
    },
  ],
  [
    "private collection, collection memberships",
    async (w) => {
      const c = await buildCollection({
        teamId: w.team.id,
        userId: w.admin.id,
        permission: null,
      });
      const d = await buildDocument({
        teamId: w.team.id,
        userId: w.admin.id,
        collectionId: c.id,
      });
      await UserMembership.create({
        userId: w.member.id,
        collectionId: c.id,
        permission: CollectionPermission.Admin,
        createdById: w.admin.id,
      });
      await UserMembership.create({
        userId: w.viewer.id,
        collectionId: c.id,
        permission: CollectionPermission.ReadWrite,
        createdById: w.admin.id,
      });
      await UserMembership.create({
        userId: w.creator.id,
        collectionId: c.id,
        permission: CollectionPermission.Read,
        createdById: w.admin.id,
      });
      return [
        ["collection admin", w.member, d.id],
        ["viewer collection ReadWrite", w.viewer, d.id],
        ["collection Read", w.creator, d.id],
      ];
    },
  ],
  [
    "draft in ReadWrite collection",
    async (w) => {
      const c = await buildCollection({
        teamId: w.team.id,
        userId: w.creator.id,
        permission: CollectionPermission.ReadWrite,
      });
      const d = await buildDraftDocument({
        teamId: w.team.id,
        userId: w.creator.id,
        collectionId: c.id,
      });
      return [
        ["creator", w.creator, d.id],
        ["member", w.member, d.id],
        ["admin", w.admin, d.id],
        ["viewer", w.viewer, d.id],
      ];
    },
  ],
  [
    "draft in Read collection",
    async (w) => {
      const c = await buildCollection({
        teamId: w.team.id,
        userId: w.creator.id,
        permission: CollectionPermission.Read,
      });
      const d = await buildDraftDocument({
        teamId: w.team.id,
        userId: w.creator.id,
        collectionId: c.id,
      });
      return [
        ["creator", w.creator, d.id],
        ["member", w.member, d.id],
        ["admin", w.admin, d.id],
      ];
    },
  ],
  [
    "draft in private collection",
    async (w) => {
      const c = await buildCollection({
        teamId: w.team.id,
        userId: w.creator.id,
        permission: null,
      });
      const d = await buildDraftDocument({
        teamId: w.team.id,
        userId: w.creator.id,
        collectionId: c.id,
      });
      return [
        ["creator", w.creator, d.id],
        ["member", w.member, d.id],
        ["admin", w.admin, d.id],
      ];
    },
  ],
  [
    "draft without collection",
    async (w) => {
      const d = await buildDraftDocument({
        teamId: w.team.id,
        userId: w.creator.id,
        collectionId: null,
      });
      return [
        ["creator", w.creator, d.id],
        ["member", w.member, d.id],
        ["admin", w.admin, d.id],
        ["stranger", w.stranger, d.id],
      ];
    },
  ],
  [
    "archived in ReadWrite collection",
    async (w) => {
      const c = await buildCollection({
        teamId: w.team.id,
        userId: w.creator.id,
        permission: CollectionPermission.ReadWrite,
      });
      const d = await buildDocument({
        teamId: w.team.id,
        userId: w.creator.id,
        collectionId: c.id,
        archivedAt: new Date(),
      });
      return [
        ["creator", w.creator, d.id],
        ["member", w.member, d.id],
        ["viewer", w.viewer, d.id],
        ["admin", w.admin, d.id],
      ];
    },
  ],
  [
    "archived in Read collection",
    async (w) => {
      const c = await buildCollection({
        teamId: w.team.id,
        userId: w.creator.id,
        permission: CollectionPermission.Read,
      });
      const d = await buildDocument({
        teamId: w.team.id,
        userId: w.creator.id,
        collectionId: c.id,
        archivedAt: new Date(),
      });
      return [
        ["creator", w.creator, d.id],
        ["member", w.member, d.id],
        ["admin", w.admin, d.id],
      ];
    },
  ],
  [
    "deleted in ReadWrite collection",
    async (w) => {
      const c = await buildCollection({
        teamId: w.team.id,
        userId: w.creator.id,
        permission: CollectionPermission.ReadWrite,
      });
      const d = await buildDocument({
        teamId: w.team.id,
        userId: w.creator.id,
        collectionId: c.id,
      });
      await d.destroy();
      return [
        ["creator", w.creator, d.id],
        ["member", w.member, d.id],
        ["viewer", w.viewer, d.id],
        ["guest", w.guest, d.id],
        ["admin", w.admin, d.id],
        ["stranger", w.stranger, d.id],
      ];
    },
  ],
  [
    "deleted in Read collection",
    async (w) => {
      const c = await buildCollection({
        teamId: w.team.id,
        userId: w.creator.id,
        permission: CollectionPermission.Read,
      });
      const d = await buildDocument({
        teamId: w.team.id,
        userId: w.creator.id,
        collectionId: c.id,
      });
      await d.destroy();
      return [
        ["creator", w.creator, d.id],
        ["member", w.member, d.id],
        ["admin", w.admin, d.id],
      ];
    },
  ],
  [
    "deleted draft",
    async (w) => {
      const c = await buildCollection({
        teamId: w.team.id,
        userId: w.creator.id,
        permission: CollectionPermission.Read,
      });
      const d = await buildDraftDocument({
        teamId: w.team.id,
        userId: w.creator.id,
        collectionId: c.id,
      });
      await d.destroy();
      return [
        ["creator", w.creator, d.id],
        ["member", w.member, d.id],
      ];
    },
  ],
  [
    "deleted draft without collection",
    async (w) => {
      const d = await buildDraftDocument({
        teamId: w.team.id,
        userId: w.creator.id,
        collectionId: null,
      });
      await d.destroy();
      return [
        ["creator", w.creator, d.id],
        ["member", w.member, d.id],
        ["admin", w.admin, d.id],
      ];
    },
  ],
  [
    "viewers cannot export",
    async (w) => {
      const c = await buildCollection({
        teamId: w.team.id,
        userId: w.creator.id,
        permission: CollectionPermission.Read,
      });
      const d = await buildDocument({
        teamId: w.team.id,
        userId: w.creator.id,
        collectionId: c.id,
      });
      await mem(w.guest.id, d.id, DocumentPermission.Read);
      return [
        ["member", w.member, d.id],
        ["viewer", w.viewer, d.id],
        ["guest", w.guest, d.id],
      ];
    },
    { [TeamPreference.ViewersCanExport]: false },
  ],
  [
    "commenting None",
    async (w) => {
      const c = await buildCollection({
        teamId: w.team.id,
        userId: w.creator.id,
        permission: CollectionPermission.ReadWrite,
      });
      const d = await buildDocument({
        teamId: w.team.id,
        userId: w.creator.id,
        collectionId: c.id,
      });
      await mem(w.guest.id, d.id, DocumentPermission.Read);
      return [
        ["member", w.member, d.id],
        ["guest", w.guest, d.id],
      ];
    },
    { [TeamPreference.Commenting]: CommentingAccess.None },
  ],
  [
    "commenting Members",
    async (w) => {
      const c = await buildCollection({
        teamId: w.team.id,
        userId: w.creator.id,
        permission: CollectionPermission.ReadWrite,
      });
      const d = await buildDocument({
        teamId: w.team.id,
        userId: w.creator.id,
        collectionId: c.id,
      });
      await mem(w.guest.id, d.id, DocumentPermission.Read);
      return [
        ["member", w.member, d.id],
        ["guest", w.guest, d.id],
      ];
    },
    { [TeamPreference.Commenting]: CommentingAccess.Members },
  ],
  [
    "commenting Everyone",
    async (w) => {
      const c = await buildCollection({
        teamId: w.team.id,
        userId: w.creator.id,
        permission: CollectionPermission.ReadWrite,
      });
      const d = await buildDocument({
        teamId: w.team.id,
        userId: w.creator.id,
        collectionId: c.id,
      });
      await mem(w.guest.id, d.id, DocumentPermission.Read);
      return [
        ["member", w.member, d.id],
        ["guest", w.guest, d.id],
      ];
    },
    { [TeamPreference.Commenting]: CommentingAccess.Everyone },
  ],
  [
    "legacy commenting false",
    async (w) => {
      const c = await buildCollection({
        teamId: w.team.id,
        userId: w.creator.id,
        permission: CollectionPermission.ReadWrite,
      });
      const d = await buildDocument({
        teamId: w.team.id,
        userId: w.creator.id,
        collectionId: c.id,
      });
      return [["member", w.member, d.id]];
    },
    { [TeamPreference.Commenting]: false },
  ],
  [
    "collection commenting off",
    async (w) => {
      const c = await buildCollection({
        teamId: w.team.id,
        userId: w.creator.id,
        permission: CollectionPermission.ReadWrite,
        commenting: false,
      });
      const d = await buildDocument({
        teamId: w.team.id,
        userId: w.creator.id,
        collectionId: c.id,
      });
      return [["member", w.member, d.id]];
    },
  ],
  [
    "non-sharing collection",
    async (w) => {
      const c = await buildCollection({
        teamId: w.team.id,
        userId: w.creator.id,
        permission: CollectionPermission.ReadWrite,
        sharing: false,
      });
      const d = await buildDocument({
        teamId: w.team.id,
        userId: w.creator.id,
        collectionId: c.id,
      });
      return [
        ["member", w.member, d.id],
        ["admin", w.admin, d.id],
      ];
    },
  ],
  [
    "draft by a member in a Read collection",
    async (w) => {
      const c = await buildCollection({
        teamId: w.team.id,
        userId: w.admin.id,
        permission: CollectionPermission.Read,
      });
      const d = await buildDraftDocument({
        teamId: w.team.id,
        userId: w.member.id,
        collectionId: c.id,
      });
      return [
        ["creator", w.member, d.id],
        ["other member", w.creator, d.id],
      ];
    },
  ],
  [
    "archived and deleted documents with document memberships",
    async (w) => {
      const c = await buildCollection({
        teamId: w.team.id,
        userId: w.admin.id,
        permission: null,
      });
      const out: Array<[string, User, string]> = [];
      for (const [name, permission] of [
        ["Read", DocumentPermission.Read],
        ["ReadWrite", DocumentPermission.ReadWrite],
        ["Admin", DocumentPermission.Admin],
      ] as const) {
        const archived = await buildDocument({
          teamId: w.team.id,
          userId: w.admin.id,
          collectionId: c.id,
          archivedAt: new Date(),
        });
        await mem(w.member.id, archived.id, permission);
        out.push([`archived ${name}`, w.member, archived.id]);
        const deleted = await buildDocument({
          teamId: w.team.id,
          userId: w.admin.id,
          collectionId: c.id,
        });
        await mem(w.member.id, deleted.id, permission);
        await deleted.destroy();
        out.push([`deleted ${name}`, w.member, deleted.id]);
      }
      return out;
    },
  ],
];

const expected: Record<string, Record<string, string[]>> = {
  "published in ReadWrite collection": {
    creator: [
      "archive",
      "comment",
      "createChildDocument",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "manageUsers",
      "move",
      "pin",
      "read",
      "share",
      "star",
      "subscribe",
      "unpin",
      "unpublish",
      "unstar",
      "unsubscribe",
      "update",
      "updateInsights",
    ],
    member: [
      "archive",
      "comment",
      "createChildDocument",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "move",
      "read",
      "share",
      "star",
      "subscribe",
      "unpublish",
      "unstar",
      "unsubscribe",
      "update",
    ],
    viewer: [
      "comment",
      "download",
      "listRevisions",
      "listViews",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    guest: [],
    admin: [
      "archive",
      "comment",
      "createChildDocument",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "manageUsers",
      "move",
      "pin",
      "pinToHome",
      "read",
      "share",
      "star",
      "subscribe",
      "unpin",
      "unpublish",
      "unstar",
      "unsubscribe",
      "update",
      "updateInsights",
    ],
    stranger: [],
  },
  "published in Read collection": {
    creator: [
      "archive",
      "comment",
      "createChildDocument",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "manageUsers",
      "move",
      "pin",
      "read",
      "share",
      "star",
      "subscribe",
      "unpin",
      "unpublish",
      "unstar",
      "unsubscribe",
      "update",
      "updateInsights",
    ],
    member: [
      "comment",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    viewer: [
      "comment",
      "download",
      "listRevisions",
      "listViews",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    guest: [],
    admin: [
      "comment",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "manageUsers",
      "pinToHome",
      "read",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
  },
  "published in private collection, no membership": {
    creator: [
      "archive",
      "comment",
      "createChildDocument",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "manageUsers",
      "move",
      "pin",
      "read",
      "share",
      "star",
      "subscribe",
      "unpin",
      "unpublish",
      "unstar",
      "unsubscribe",
      "update",
      "updateInsights",
    ],
    member: [],
    viewer: [],
    guest: [],
    admin: ["pinToHome"],
  },
  "private collection, document memberships": {
    "member Read": [
      "comment",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    "guest Read": [
      "download",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    "member ReadWrite": [
      "comment",
      "createChildDocument",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "move",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
    ],
    "guest ReadWrite": [
      "createChildDocument",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "move",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
    ],
    "viewer ReadWrite": [
      "comment",
      "createChildDocument",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "move",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
    ],
    "member Admin": [
      "archive",
      "comment",
      "createChildDocument",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "manageUsers",
      "move",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
    ],
    "guest Admin": [
      "archive",
      "createChildDocument",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "manageUsers",
      "move",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
    ],
  },
  "private collection, group document membership": {
    "group member": [
      "comment",
      "createChildDocument",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "move",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
    ],
    "non member": [],
  },
  "private collection, collection memberships": {
    "collection admin": [
      "archive",
      "comment",
      "createChildDocument",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "manageUsers",
      "move",
      "pin",
      "read",
      "share",
      "star",
      "subscribe",
      "unpin",
      "unpublish",
      "unstar",
      "unsubscribe",
      "update",
      "updateInsights",
    ],
    "viewer collection ReadWrite": [
      "archive",
      "comment",
      "createChildDocument",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "move",
      "read",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
    ],
    "collection Read": [
      "comment",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
  },
  "draft in ReadWrite collection": {
    creator: [
      "comment",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "manageUsers",
      "move",
      "publish",
      "read",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
    ],
    member: [
      "comment",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "move",
      "publish",
      "read",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
    ],
    admin: [
      "comment",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "manageUsers",
      "move",
      "publish",
      "read",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
    ],
    viewer: [
      "comment",
      "download",
      "listRevisions",
      "listViews",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
  },
  "draft in Read collection": {
    creator: [
      "comment",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "manageUsers",
      "move",
      "publish",
      "read",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
    ],
    member: [
      "comment",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    admin: [
      "comment",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "manageUsers",
      "read",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
  },
  "draft in private collection": {
    creator: [
      "comment",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "manageUsers",
      "move",
      "publish",
      "read",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
    ],
    member: [],
    admin: [],
  },
  "draft without collection": {
    creator: [
      "comment",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "manageUsers",
      "move",
      "publish",
      "read",
      "share",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
    ],
    member: [],
    admin: [],
    stranger: [],
  },
  "archived in ReadWrite collection": {
    creator: [
      "delete",
      "download",
      "listRevisions",
      "listViews",
      "manageUsers",
      "read",
      "star",
      "subscribe",
      "unarchive",
      "unstar",
      "unsubscribe",
      "updateDeprecatedReason",
    ],
    member: [
      "delete",
      "download",
      "listRevisions",
      "listViews",
      "read",
      "star",
      "subscribe",
      "unarchive",
      "unstar",
      "unsubscribe",
      "updateDeprecatedReason",
    ],
    viewer: [
      "download",
      "listRevisions",
      "listViews",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    admin: [
      "delete",
      "download",
      "listRevisions",
      "listViews",
      "manageUsers",
      "read",
      "star",
      "subscribe",
      "unarchive",
      "unstar",
      "unsubscribe",
      "updateDeprecatedReason",
    ],
  },
  "archived in Read collection": {
    creator: [
      "delete",
      "download",
      "listRevisions",
      "listViews",
      "manageUsers",
      "read",
      "star",
      "subscribe",
      "unarchive",
      "unstar",
      "unsubscribe",
      "updateDeprecatedReason",
    ],
    member: [
      "download",
      "listRevisions",
      "listViews",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    admin: [
      "download",
      "listRevisions",
      "listViews",
      "manageUsers",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
  },
  "deleted in ReadWrite collection": {
    creator: [
      "download",
      "listRevisions",
      "listViews",
      "manageUsers",
      "read",
      "restore",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDeprecatedReason",
    ],
    member: [
      "download",
      "listRevisions",
      "listViews",
      "read",
      "restore",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDeprecatedReason",
    ],
    viewer: [
      "download",
      "listRevisions",
      "listViews",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    guest: [],
    admin: [
      "download",
      "listRevisions",
      "listViews",
      "manageUsers",
      "permanentDelete",
      "read",
      "restore",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDeprecatedReason",
    ],
    stranger: [],
  },
  "deleted in Read collection": {
    creator: [
      "download",
      "listRevisions",
      "listViews",
      "manageUsers",
      "read",
      "restore",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDeprecatedReason",
    ],
    member: [
      "download",
      "listRevisions",
      "listViews",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    admin: [
      "download",
      "listRevisions",
      "listViews",
      "manageUsers",
      "permanentDelete",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
  },
  "deleted draft": {
    creator: [
      "download",
      "listRevisions",
      "listViews",
      "manageUsers",
      "read",
      "restore",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDeprecatedReason",
    ],
    member: [
      "download",
      "listRevisions",
      "listViews",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
  },
  "deleted draft without collection": {
    creator: [
      "download",
      "listRevisions",
      "listViews",
      "manageUsers",
      "read",
      "restore",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDeprecatedReason",
    ],
    member: [],
    admin: ["permanentDelete"],
  },
  "viewers cannot export": {
    member: [
      "comment",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    viewer: [
      "comment",
      "listRevisions",
      "listViews",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    guest: ["read", "star", "subscribe", "unstar", "unsubscribe"],
  },
  "commenting None": {
    member: [
      "archive",
      "createChildDocument",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "move",
      "read",
      "share",
      "star",
      "subscribe",
      "unpublish",
      "unstar",
      "unsubscribe",
      "update",
    ],
    guest: ["download", "read", "star", "subscribe", "unstar", "unsubscribe"],
  },
  "commenting Members": {
    member: [
      "archive",
      "comment",
      "createChildDocument",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "move",
      "read",
      "share",
      "star",
      "subscribe",
      "unpublish",
      "unstar",
      "unsubscribe",
      "update",
    ],
    guest: ["download", "read", "star", "subscribe", "unstar", "unsubscribe"],
  },
  "commenting Everyone": {
    member: [
      "archive",
      "comment",
      "createChildDocument",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "move",
      "read",
      "share",
      "star",
      "subscribe",
      "unpublish",
      "unstar",
      "unsubscribe",
      "update",
    ],
    guest: [
      "comment",
      "download",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
  },
  "legacy commenting false": {
    member: [
      "archive",
      "createChildDocument",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "move",
      "read",
      "share",
      "star",
      "subscribe",
      "unpublish",
      "unstar",
      "unsubscribe",
      "update",
    ],
  },
  "collection commenting off": {
    member: [
      "archive",
      "createChildDocument",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "move",
      "read",
      "share",
      "star",
      "subscribe",
      "unpublish",
      "unstar",
      "unsubscribe",
      "update",
    ],
  },
  "non-sharing collection": {
    member: [
      "archive",
      "comment",
      "createChildDocument",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "move",
      "read",
      "star",
      "subscribe",
      "unpublish",
      "unstar",
      "unsubscribe",
      "update",
    ],
    admin: [
      "archive",
      "comment",
      "createChildDocument",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "manageUsers",
      "move",
      "pin",
      "pinToHome",
      "read",
      "star",
      "subscribe",
      "unpin",
      "unpublish",
      "unstar",
      "unsubscribe",
      "update",
      "updateInsights",
    ],
  },
  "draft by a member in a Read collection": {
    creator: [
      "comment",
      "delete",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "manageUsers",
      "move",
      "publish",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "update",
    ],
    "other member": [
      "comment",
      "download",
      "duplicate",
      "listRevisions",
      "listViews",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
  },
  "archived and deleted documents with document memberships": {
    "archived Read": [
      "download",
      "listRevisions",
      "listViews",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    "deleted Read": [
      "download",
      "listRevisions",
      "listViews",
      "read",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
    ],
    "archived ReadWrite": [
      "delete",
      "download",
      "listRevisions",
      "listViews",
      "read",
      "star",
      "subscribe",
      "unarchive",
      "unstar",
      "unsubscribe",
      "updateDeprecatedReason",
    ],
    "deleted ReadWrite": [
      "download",
      "listRevisions",
      "listViews",
      "read",
      "restore",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDeprecatedReason",
    ],
    "archived Admin": [
      "delete",
      "download",
      "listRevisions",
      "listViews",
      "manageUsers",
      "read",
      "star",
      "subscribe",
      "unarchive",
      "unstar",
      "unsubscribe",
      "updateDeprecatedReason",
    ],
    "deleted Admin": [
      "download",
      "listRevisions",
      "listViews",
      "manageUsers",
      "read",
      "restore",
      "star",
      "subscribe",
      "unstar",
      "unsubscribe",
      "updateDeprecatedReason",
    ],
  },
};

describe("document policy matrix", () => {
  for (const [label, build, prefs] of scenarios) {
    it(`grants exactly the expected abilities: ${label}`, async () => {
      const w = await buildWorld(prefs);
      const cases = await build(w);
      expect(cases.map(([who]) => who).sort()).toEqual(
        Object.keys(expected[label]).sort()
      );
      for (const [who, user, id] of cases) {
        expect([who, await granted(user, id)]).toEqual([
          who,
          sorted(expected[label][who]),
        ]);
      }
    });
  }

  it("lets only non-guest, non-viewer members create documents in the team", async () => {
    const w = await buildWorld();
    const can = (user: User) => !!serialize(user, w.team).createDocument;
    expect(can(w.member)).toBe(true);
    expect(can(w.admin)).toBe(true);
    expect(can(w.viewer)).toBe(false);
    expect(can(w.guest)).toBe(false);
    expect(can(w.stranger)).toBe(false);
  });

  it("denies every ability when the document is missing", async () => {
    const w = await buildWorld();
    for (const user of [w.member, w.viewer, w.guest, w.admin, w.stranger]) {
      expect(Object.values(serialize(user, null)).filter(Boolean)).toEqual([]);
    }
  });

  it("restores a revision only into its own document", async () => {
    const w = await buildWorld();
    const c = await buildCollection({
      teamId: w.team.id,
      userId: w.creator.id,
    });
    const a = await buildDocument({
      teamId: w.team.id,
      userId: w.creator.id,
      collectionId: c.id,
    });
    const b = await buildDocument({
      teamId: w.team.id,
      userId: w.creator.id,
      collectionId: c.id,
    });
    const revision = Revision.buildFromDocument(a);
    expect(serialize(a, revision).restore).toBe(true);
    expect(serialize(b, revision).restore).toBe(false);
  });
});
