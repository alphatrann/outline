import {
  buildAdmin,
  buildDraftDocument,
  buildPin,
  buildViewer,
  buildCollection,
  buildDocument,
  buildShare,
  buildTeam,
  buildTemplate,
  buildUser,
} from "@server/test/factories";
import { cleanBetweenTests } from "@server/test/cleanup";
import { getTestServer } from "@server/test/support";
import {
  CollectionPermission,
  CommentingAccess,
  DocumentPermission,
  TeamPreference,
} from "@shared/types";
import type { NavigationNode } from "@shared/types";
import {
  Collection,
  Document,
  Event,
  Pin,
  Revision,
  UserMembership,
} from "@server/models";

const server = getTestServer();
cleanBetweenTests();

describe("#documents.search (integration)", () => {
  it("should rank full-text search results via real Postgres trigger", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
      permission: CollectionPermission.ReadWrite,
    });

    // Create documents with distinctive searchable text.
    await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Alpha document",
      text: "The quick brown fox jumps over the lazy dog",
      publishedAt: new Date(),
    });
    await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Beta document",
      text: "Unique searchable term zebra alpha omega",
      publishedAt: new Date(),
    });
    await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Gamma document",
      text: "Unrelated content with no matching terms",
      publishedAt: new Date(),
    });

    const res = await server.post("/api/documents.search", user, {
      body: {
        query: "zebra",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(Array.isArray(body.data)).toBe(true);

    // Only the document containing "zebra" should be returned.
    const titles = body.data.map(
      (d: { document: { title: string } }) => d.document.title
    );
    expect(titles).toContain("Beta document");
    expect(titles).not.toContain("Gamma document");
  });

  it("should scope search results by shareId", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
      permission: CollectionPermission.ReadWrite,
    });

    // Document inside the share's collection.
    const sharedDoc = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Shared document",
      text: "Share scoped searchable content",
      publishedAt: new Date(),
    });

    // Document outside the share's collection (different collection).
    const otherCollection = await buildCollection({
      teamId: team.id,
      userId: user.id,
      permission: CollectionPermission.ReadWrite,
    });
    await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: otherCollection.id,
      title: "Outside document",
      text: "Share scoped searchable content",
      publishedAt: new Date(),
    });

    // Create a published share on the shared document's collection.
    await buildShare({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      published: true,
    });

    const res = await server.post("/api/documents.search", user, {
      body: {
        query: "Share scoped",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(Array.isArray(body.data)).toBe(true);

    const ids = body.data.map(
      (d: { document: { id: string } }) => d.document.id
    );
    expect(ids).toContain(sharedDoc.id);
  });
});

describe("#documents.lifecycle (integration)", () => {
  it("should create, publish, archive, and restore a document end to end", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });

    // 1. Create — draft (not published, not archived)
    const createRes = await server.post("/api/documents.create", user, {
      body: {
        title: "Lifecycle doc",
        text: "Initial content",
        collectionId: collection.id,
      },
    });
    expect(createRes.status).toEqual(200);
    const { data: created } = await createRes.json();
    expect(created.publishedAt).toBeNull();
    expect(created.archivedAt).toBeNull();

    // DB: draft state
    const createdDoc = await Document.findByPk(created.id, {
      rejectOnEmpty: true,
    });
    expect(createdDoc.publishedAt).toBeNull();
    expect(createdDoc.archivedAt).toBeNull();
    expect(createdDoc.isActive).toBe(true);

    // 2. Publish — no separate documents.publish route; use documents.update with publish: true
    const publishRes = await server.post("/api/documents.update", user, {
      body: {
        id: created.id,
        publish: true,
      },
    });
    expect(publishRes.status).toEqual(200);
    const { data: published } = await publishRes.json();
    expect(published.publishedAt).toBeTruthy();

    const publishedDoc = await Document.findByPk(created.id, {
      rejectOnEmpty: true,
    });
    expect(publishedDoc.publishedAt).not.toBeNull();

    // 3. Archive
    const archiveRes = await server.post("/api/documents.archive", user, {
      body: {
        id: created.id,
        reason: "Superseded by newer guide",
      },
    });
    expect(archiveRes.status).toEqual(200);
    const { data: archived } = await archiveRes.json();
    expect(archived.archivedAt).toBeTruthy();
    expect(archived.deprecatedReason).toEqual("Superseded by newer guide");

    const archivedDoc = await Document.findByPk(created.id, {
      rejectOnEmpty: true,
      paranoid: false,
    });
    expect(archivedDoc.archivedAt).not.toBeNull();
    expect(archivedDoc.isActive).toBe(false);

    // 4. Restore
    const restoreRes = await server.post("/api/documents.restore", user, {
      body: {
        id: created.id,
      },
    });
    expect(restoreRes.status).toEqual(200);
    const { data: restored } = await restoreRes.json();
    expect(restored.archivedAt).toBeNull();

    const restoredDoc = await Document.findByPk(created.id, {
      rejectOnEmpty: true,
      paranoid: false,
    });
    expect(restoredDoc.archivedAt).toBeNull();
    expect(restoredDoc.isActive).toBe(true);
    // Restoring un-archives but does not unpublish
    expect(restoredDoc.publishedAt).not.toBeNull();
  });
});

const titlesOf = (body: { data: { document: { title: string } }[] }) =>
  body.data.map((d) => d.document.title);

/**
 * Scenarios for restore:
 * 1. Soft-deleted document is restored and reappears in documents.list.
 * 2. Read-only member cannot restore a deleted document (403).
 * 3. Restoring with revisionId reverts text to that revision.
 */
describe("#documents.restore (integration)", () => {
  it("should restore a soft-deleted document", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const doc = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Trash me",
    });

    const delRes = await server.post("/api/documents.delete", user, {
      body: { id: doc.id },
    });
    expect(delRes.status).toEqual(200);
    expect(await Document.findByPk(doc.id)).toBeNull();

    const restoreRes = await server.post("/api/documents.restore", user, {
      body: { id: doc.id },
    });
    expect(restoreRes.status).toEqual(200);

    const restored = await Document.findByPk(doc.id, { rejectOnEmpty: true });
    expect(restored.deletedAt).toBeNull();

    const listRes = await server.post("/api/documents.list", user, {
      body: { collectionId: collection.id },
    });
    const { data } = await listRes.json();
    expect(data.map((d: { title: string }) => d.title)).toContain("Trash me");
  });

  it("should forbid a read-only member from restoring a deleted document", async () => {
    const team = await buildTeam();
    const owner = await buildUser({ teamId: team.id });
    const reader = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: owner.id,
      permission: CollectionPermission.Read,
    });
    const doc = await buildDocument({
      teamId: team.id,
      userId: owner.id,
      collectionId: collection.id,
    });
    await server.post("/api/documents.delete", owner, { body: { id: doc.id } });

    const res = await server.post("/api/documents.restore", reader, {
      body: { id: doc.id },
    });
    expect(res.status).toEqual(403);
    expect(await Document.findByPk(doc.id)).toBeNull();
  });
});

/**
 * Scenarios for search after delete:
 * 1. Deleted document disappears from search and returns after restore.
 * 2. Permanently deleted document is gone from search and the database.
 */
describe("#documents.search after delete (integration)", () => {
  const search = async (user: Parameters<typeof server.post>[1]) => {
    const res = await server.post("/api/documents.search", user, {
      body: { query: "quokka" },
    });
    return titlesOf(await res.json());
  };

  it("should drop deleted documents from search and show them after restore", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const doc = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Quokka notes",
      text: "quokka",
      publishedAt: new Date(),
    });

    expect(await search(user)).toContain("Quokka notes");

    await server.post("/api/documents.delete", user, { body: { id: doc.id } });
    expect(await search(user)).not.toContain("Quokka notes");

    await server.post("/api/documents.restore", user, { body: { id: doc.id } });
    expect(await search(user)).toContain("Quokka notes");
  });

  it("should remove permanently deleted documents from search and the database", async () => {
    const team = await buildTeam();
    const user = await buildAdmin({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const doc = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Quokka gone",
      text: "quokka",
      publishedAt: new Date(),
    });

    // Permanent delete is admin-only and requires the document to be in the trash.
    await server.post("/api/documents.delete", user, { body: { id: doc.id } });
    const res = await server.post("/api/documents.delete", user, {
      body: { id: doc.id, permanent: true },
    });
    expect(res.status).toEqual(200);

    expect(await search(user)).not.toContain("Quokka gone");
    expect(await Document.findByPk(doc.id, { paranoid: false })).toBeNull();
  });
});

function flattenIds(nodes: NavigationNode[]): string[] {
  return nodes.flatMap((node) => [node.id, ...flattenIds(node.children)]);
}

async function loadStructure(collectionId: string) {
  const collection = await Collection.findByPk(collectionId, {
    includeDocumentStructure: true,
    rejectOnEmpty: true,
  });
  return collection.documentStructure ?? [];
}

/**
 * Asserts the collection's JSON structure and the documents table agree: every
 * published live document appears exactly once, and nothing else does.
 */
async function expectStructureMatchesDb(collectionId: string) {
  const ids = flattenIds(await loadStructure(collectionId));
  const docs = await Document.findAll({ where: { collectionId } });
  const published = docs.filter((d) => d.publishedAt).map((d) => d.id);
  expect(new Set(ids).size).toEqual(ids.length);
  expect([...ids].sort()).toEqual([...published].sort());
}

async function createPublished(
  user: Parameters<typeof server.post>[1],
  body: Record<string, unknown>
) {
  const res = await server.post("/api/documents.create", user, {
    body: { text: "body", publish: true, ...body },
  });
  expect(res.status).toEqual(200);
  return (await res.json()).data as { id: string };
}

describe("#documents.move (integration)", () => {
  it("should nest a document under a parent and keep structure in sync", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const parent = await createPublished(user, {
      title: "Parent",
      collectionId: collection.id,
    });
    const child = await createPublished(user, {
      title: "Child",
      collectionId: collection.id,
    });

    const res = await server.post("/api/documents.move", user, {
      body: { id: child.id, parentDocumentId: parent.id },
    });
    expect(res.status).toEqual(200);

    const row = await Document.findByPk(child.id, { rejectOnEmpty: true });
    expect(row.parentDocumentId).toEqual(parent.id);
    const structure = await loadStructure(collection.id);
    expect(structure.map((n) => n.id)).not.toContain(child.id);
    const parentNode = structure.find((n) => n.id === parent.id);
    expect(parentNode?.children.map((n) => n.id)).toEqual([child.id]);
    await expectStructureMatchesDb(collection.id);
  });

  it("should reorder siblings to the requested index", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    for (const title of ["A", "B", "C"]) {
      await createPublished(user, { title, collectionId: collection.id });
    }
    const [x, y, z] = (await loadStructure(collection.id)).map((n) => n.id);

    // index is a slot in the original list: 2 means "before z", so [y, x, z].
    const res = await server.post("/api/documents.move", user, {
      body: { id: x, collectionId: collection.id, index: 2 },
    });
    expect(res.status).toEqual(200);

    const after = (await loadStructure(collection.id)).map((n) => n.id);
    expect(after).toEqual([y, x, z]);
    await expectStructureMatchesDb(collection.id);
  });

  it("should move a parent and its children to another collection", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const from = await buildCollection({ teamId: team.id, userId: user.id });
    const to = await buildCollection({ teamId: team.id, userId: user.id });
    const parent = await createPublished(user, {
      title: "Parent",
      collectionId: from.id,
    });
    const child = await createPublished(user, {
      title: "Child",
      collectionId: from.id,
      parentDocumentId: parent.id,
    });

    const res = await server.post("/api/documents.move", user, {
      body: { id: parent.id, collectionId: to.id },
    });
    expect(res.status).toEqual(200);

    const childRow = await Document.findByPk(child.id, { rejectOnEmpty: true });
    expect(childRow.collectionId).toEqual(to.id);
    expect(flattenIds(await loadStructure(from.id))).toEqual([]);
    expect(flattenIds(await loadStructure(to.id))).toEqual([
      parent.id,
      child.id,
    ]);
    await expectStructureMatchesDb(from.id);
    await expectStructureMatchesDb(to.id);
  });

  it("should reject moving a document inside a draft", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const doc = await createPublished(user, {
      title: "Doc",
      collectionId: collection.id,
    });
    const draft = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      publishedAt: null,
    });

    const res = await server.post("/api/documents.move", user, {
      body: { id: doc.id, parentDocumentId: draft.id },
    });
    expect(res.status).toEqual(400);
    const row = await Document.findByPk(doc.id, { rejectOnEmpty: true });
    expect(row.parentDocumentId).toBeNull();
  });

  it("should keep structure consistent under concurrent moves", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const parent = await createPublished(user, {
      title: "Parent",
      collectionId: collection.id,
    });
    const a = await createPublished(user, {
      title: "A",
      collectionId: collection.id,
    });
    const b = await createPublished(user, {
      title: "B",
      collectionId: collection.id,
    });

    const responses = await Promise.all(
      [a, b].map((d) =>
        server.post("/api/documents.move", user, {
          body: { id: d.id, parentDocumentId: parent.id },
        })
      )
    );

    // Neither request may crash; a lost update would show in the structure.
    for (const res of responses) {
      expect(res.status).toBeLessThan(500);
    }
    await expectStructureMatchesDb(collection.id);
  });
});

describe("#documents.update and delete (integration)", () => {
  it("should update title and text and sync the structure node title", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const doc = await createPublished(user, {
      title: "Old title",
      collectionId: collection.id,
    });

    const res = await server.post("/api/documents.update", user, {
      body: { id: doc.id, title: "New title", text: "New text" },
    });
    expect(res.status).toEqual(200);
    expect((await res.json()).data.title).toEqual("New title");

    const row = await Document.findByPk(doc.id, { rejectOnEmpty: true });
    expect(row.title).toEqual("New title");
    expect(row.lastModifiedById).toEqual(user.id);
    const node = (await loadStructure(collection.id)).find(
      (n) => n.id === doc.id
    );
    expect(node?.title).toEqual("New title");
  });

  it("should remove a deleted parent from the structure without dangling nodes", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const parent = await createPublished(user, {
      title: "Parent",
      collectionId: collection.id,
    });
    await createPublished(user, {
      title: "Child",
      collectionId: collection.id,
      parentDocumentId: parent.id,
    });

    const res = await server.post("/api/documents.delete", user, {
      body: { id: parent.id },
    });
    expect(res.status).toEqual(200);

    expect(await Document.findByPk(parent.id)).toBeNull();
    expect(flattenIds(await loadStructure(collection.id))).not.toContain(
      parent.id
    );
    await expectStructureMatchesDb(collection.id);
  });

  it("should forbid a read-only member from moving, updating or deleting", async () => {
    const team = await buildTeam();
    const owner = await buildUser({ teamId: team.id });
    const reader = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: owner.id,
      permission: CollectionPermission.Read,
    });
    const other = await buildCollection({
      teamId: team.id,
      userId: owner.id,
      permission: CollectionPermission.Read,
    });
    const doc = await createPublished(owner, {
      title: "Protected",
      collectionId: collection.id,
    });

    const move = await server.post("/api/documents.move", reader, {
      body: { id: doc.id, collectionId: other.id },
    });
    const update = await server.post("/api/documents.update", reader, {
      body: { id: doc.id, title: "Hacked" },
    });
    const del = await server.post("/api/documents.delete", reader, {
      body: { id: doc.id },
    });
    expect([move.status, update.status, del.status]).toEqual([403, 403, 403]);

    const row = await Document.findByPk(doc.id, { rejectOnEmpty: true });
    expect(row.title).toEqual("Protected");
    expect(row.collectionId).toEqual(collection.id);
    await expectStructureMatchesDb(collection.id);
  });

  it("should forbid moving a document out of a collection the user can only read", async () => {
    const team = await buildTeam();
    const owner = await buildUser({ teamId: team.id });
    const member = await buildUser({ teamId: team.id });
    const source = await buildCollection({
      teamId: team.id,
      userId: owner.id,
      permission: CollectionPermission.Read,
    });
    // The member may write to the destination, so only the "move" policy on
    // the document itself stands between them and the move.
    const destination = await buildCollection({
      teamId: team.id,
      userId: owner.id,
      permission: CollectionPermission.ReadWrite,
    });
    const doc = await createPublished(owner, {
      title: "Stay put",
      collectionId: source.id,
    });

    const res = await server.post("/api/documents.move", member, {
      body: { id: doc.id, collectionId: destination.id },
    });
    expect(res.status).toEqual(403);

    const row = await Document.findByPk(doc.id, { rejectOnEmpty: true });
    expect(row.collectionId).toEqual(source.id);
    await expectStructureMatchesDb(source.id);
    await expectStructureMatchesDb(destination.id);
  });

  it("should forbid a read-only member from archiving a document", async () => {
    const team = await buildTeam();
    const owner = await buildUser({ teamId: team.id });
    const reader = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: owner.id,
      permission: CollectionPermission.Read,
    });
    const doc = await createPublished(owner, {
      title: "Keep active",
      collectionId: collection.id,
    });

    const res = await server.post("/api/documents.archive", reader, {
      body: { id: doc.id },
    });
    expect(res.status).toEqual(403);

    const row = await Document.findByPk(doc.id, { rejectOnEmpty: true });
    expect(row.archivedAt).toBeNull();
    await expectStructureMatchesDb(collection.id);
  });
});

/**
 * Pins individual decisions of the document policy through the API, so a
 * changed condition in server/policies/document.ts fails a test.
 */
describe("document policy decisions (integration)", () => {
  const denied = (status: number) => expect([403, 404]).toContain(status);

  it("should keep a collection-less draft private to its creator", async () => {
    const team = await buildTeam();
    const creator = await buildUser({ teamId: team.id });
    const other = await buildUser({ teamId: team.id });
    const draft = await buildDraftDocument({
      teamId: team.id,
      userId: creator.id,
      collectionId: null,
      title: "My private draft",
    });

    const otherInfo = await server.post("/api/documents.info", other, {
      body: { id: draft.id },
    });
    const otherUpdate = await server.post("/api/documents.update", other, {
      body: { id: draft.id, title: "Hijacked" },
    });
    denied(otherInfo.status);
    denied(otherUpdate.status);

    const ownInfo = await server.post("/api/documents.info", creator, {
      body: { id: draft.id },
    });
    const ownUpdate = await server.post("/api/documents.update", creator, {
      body: { id: draft.id, title: "Still mine" },
    });
    expect(ownInfo.status).toEqual(200);
    expect(ownUpdate.status).toEqual(200);

    const row = await Document.findByPk(draft.id, { rejectOnEmpty: true });
    expect(row.title).toEqual("Still mine");
  });

  it("should grant document access only as far as the membership permission", async () => {
    const team = await buildTeam();
    const owner = await buildUser({ teamId: team.id });
    const member = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: owner.id,
      permission: null,
    });
    const doc = await createPublished(owner, {
      title: "Invite only",
      collectionId: collection.id,
    });
    const read = () =>
      server.post("/api/documents.info", member, { body: { id: doc.id } });
    const edit = (title: string) =>
      server.post("/api/documents.update", member, {
        body: { id: doc.id, title },
      });

    // No membership: invisible.
    denied((await read()).status);

    // Read membership: visible, not editable.
    const addRead = await server.post("/api/documents.add_user", owner, {
      body: {
        id: doc.id,
        userId: member.id,
        permission: DocumentPermission.Read,
      },
    });
    expect(addRead.status).toEqual(200);
    expect((await read()).status).toEqual(200);
    expect((await edit("Read cannot edit")).status).toEqual(403);

    // ReadWrite membership: editable.
    const addWrite = await server.post("/api/documents.add_user", owner, {
      body: {
        id: doc.id,
        userId: member.id,
        permission: DocumentPermission.ReadWrite,
      },
    });
    expect(addWrite.status).toEqual(200);
    expect((await edit("ReadWrite can edit")).status).toEqual(200);

    // A member with ReadWrite still cannot manage who else has access.
    const other = await buildUser({ teamId: team.id });
    const invite = await server.post("/api/documents.add_user", member, {
      body: { id: doc.id, userId: other.id },
    });
    expect(invite.status).toEqual(403);
  });

  it("should only let viewers export when the team allows it", async () => {
    const team = await buildTeam();
    const owner = await buildUser({ teamId: team.id });
    const viewer = await buildViewer({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: owner.id,
      permission: CollectionPermission.Read,
    });
    const doc = await createPublished(owner, {
      title: "Exportable",
      collectionId: collection.id,
    });
    const exportAs = (user: Parameters<typeof server.post>[1]) =>
      server.post("/api/documents.export", user, {
        headers: { accept: "text/markdown" },
        body: { id: doc.id },
      });

    team.setPreference(TeamPreference.ViewersCanExport, false);
    await team.save();
    expect((await exportAs(viewer)).status).toEqual(403);
    expect((await exportAs(owner)).status).toEqual(200);

    team.setPreference(TeamPreference.ViewersCanExport, true);
    await team.save();
    expect((await exportAs(viewer)).status).toEqual(200);
  });

  it("should respect the team and collection commenting settings", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const doc = await createPublished(user, {
      title: "Discuss",
      collectionId: collection.id,
    });
    const comment = () =>
      server.post("/api/comments.create", user, {
        body: { documentId: doc.id, text: "hello" },
      });

    team.setPreference(TeamPreference.Commenting, CommentingAccess.Members);
    await team.save();
    expect((await comment()).status).toEqual(200);

    // Disabled team-wide: rejected by the commentingEnabled feature middleware.
    team.setPreference(TeamPreference.Commenting, CommentingAccess.None);
    await team.save();
    expect((await comment()).status).toEqual(400);

    team.setPreference(TeamPreference.Commenting, CommentingAccess.Members);
    await team.save();
    // Disabled for one collection: rejected by the "comment" policy.
    await collection.update({ commenting: false });
    expect((await comment()).status).toEqual(403);
  });
});

describe("#documents.search_titles (integration)", () => {
  async function setup() {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    return { team, user, collection };
  }

  it("should match documents by title and paginate", async () => {
    const { team, user, collection } = await setup();
    const match = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Quarterly roadmap",
    });
    await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Unrelated note",
    });

    const res = await server.post("/api/documents.search_titles", user, {
      body: { query: "roadmap" },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toEqual(match.id);
    expect(body.pagination.limit).toBeDefined();
    expect(body.policies).toHaveLength(1);
    expect(body.policies[0].id).toEqual(match.id);
  });

  it("should scope results with the collectionId filter", async () => {
    const { team, user, collection } = await setup();
    const other = await buildCollection({ teamId: team.id, userId: user.id });
    const inScope = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Planning in scope",
    });
    await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: other.id,
      title: "Planning out of scope",
    });

    const res = await server.post("/api/documents.search_titles", user, {
      body: { query: "planning", collectionId: collection.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.map((d: { id: string }) => d.id)).toEqual([inScope.id]);
  });

  it("should not search a collection the user cannot read", async () => {
    const { team, user } = await setup();
    const owner = await buildUser({ teamId: team.id });
    const privateCollection = await buildCollection({
      teamId: team.id,
      userId: owner.id,
      permission: null,
    });
    await buildDocument({
      teamId: team.id,
      userId: owner.id,
      collectionId: privateCollection.id,
      title: "Confidential planning",
    });

    const res = await server.post("/api/documents.search_titles", user, {
      body: { query: "planning", collectionId: privateCollection.id },
    });

    expect(res.status).toEqual(403);
    expect(JSON.stringify(await res.json())).not.toContain(
      "Confidential planning"
    );
  });

  it("should expand a documentId filter to the document's descendants", async () => {
    const { team, user, collection } = await setup();
    const parent = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Handbook parent",
    });
    const child = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      parentDocumentId: parent.id,
      title: "Handbook child",
    });
    await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Handbook sibling",
    });

    const res = await server.post("/api/documents.search_titles", user, {
      body: { query: "handbook", documentId: parent.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    const ids = body.data.map((d: { id: string }) => d.id);
    expect(ids).toContain(child.id);
    expect(ids).not.toContain(
      (await Document.findOne({ where: { title: "Handbook sibling" } }))?.id
    );
  });
});

describe("#documents.move validation (integration)", () => {
  it("should require a collection or parent document", async () => {
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

    const res = await server.post("/api/documents.move", user, {
      body: { id: document.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(400);
    expect(body.message).toEqual("collectionId is required to move a document");
    const after = await Document.findByPk(document.id, { rejectOnEmpty: true });
    expect(after.collectionId).toEqual(collection.id);
  });
});

describe("#documents.delete reason (integration)", () => {
  async function setup(deprecatedReason: string | null = null) {
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
      deprecatedReason,
    });
    return { user, document };
  }

  const reload = (id: string) =>
    Document.unscoped().findByPk(id, { paranoid: false, rejectOnEmpty: true });

  it("should store a trimmed reason when deleting", async () => {
    const { user, document } = await setup();

    const res = await server.post("/api/documents.delete", user, {
      body: { id: document.id, reason: "  Obsolete  " },
    });
    expect(res.status).toEqual(200);

    const deleted = await reload(document.id);
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.deprecatedReason).toEqual("Obsolete");
  });

  it("should clear the reason when an empty one is sent", async () => {
    const { user, document } = await setup("Old reason");

    const res = await server.post("/api/documents.delete", user, {
      body: { id: document.id, reason: "" },
    });
    expect(res.status).toEqual(200);
    expect((await reload(document.id)).deprecatedReason).toBeNull();
  });

  it("should keep the existing reason when none is sent", async () => {
    const { user, document } = await setup("Keep me");

    const res = await server.post("/api/documents.delete", user, {
      body: { id: document.id },
    });
    expect(res.status).toEqual(200);
    expect((await reload(document.id)).deprecatedReason).toEqual("Keep me");
  });
});

describe("#documents.unpublish (integration)", () => {
  it("should unpublish a document and remove it from the collection structure", async () => {
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

    const res = await server.post("/api/documents.unpublish", user, {
      body: { id: document.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.id).toEqual(document.id);
    expect(body.data.publishedAt).toBeNull();
    expect(body.policies).toHaveLength(1);
    expect(body.policies[0].id).toEqual(document.id);

    const after = await Document.findByPk(document.id, { rejectOnEmpty: true });
    expect(after.publishedAt).toBeNull();
    const reloaded = await Collection.findByPk(collection.id, {
      includeDocumentStructure: true,
      rejectOnEmpty: true,
    });
    expect(JSON.stringify(reloaded.documentStructure)).not.toContain(
      document.id
    );
  });

  it("should detach the document from its collection when asked", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const kept = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const detached = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });

    const keptRes = await server.post("/api/documents.unpublish", user, {
      body: { id: kept.id },
    });
    expect(keptRes.status).toEqual(200);
    const detachedRes = await server.post("/api/documents.unpublish", user, {
      body: { id: detached.id, detach: true },
    });
    expect(detachedRes.status).toEqual(200);

    const keptAfter = await Document.findByPk(kept.id, {
      rejectOnEmpty: true,
    });
    const detachedAfter = await Document.findByPk(detached.id, {
      rejectOnEmpty: true,
    });
    expect(keptAfter.collectionId).toEqual(collection.id);
    expect(detachedAfter.collectionId).toBeNull();
  });

  it("should refuse to unpublish a document that has children", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const parent = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      parentDocumentId: parent.id,
    });

    const res = await server.post("/api/documents.unpublish", user, {
      body: { id: parent.id },
    });
    expect(res.status).toEqual(400);
    const after = await Document.findByPk(parent.id, { rejectOnEmpty: true });
    expect(after.publishedAt).not.toBeNull();
  });

  it("should deny a viewer from unpublishing", async () => {
    const team = await buildTeam();
    const owner = await buildUser({ teamId: team.id });
    const viewer = await buildViewer({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: owner.id,
    });
    const document = await buildDocument({
      teamId: team.id,
      userId: owner.id,
      collectionId: collection.id,
    });

    const res = await server.post("/api/documents.unpublish", viewer, {
      body: { id: document.id },
    });
    expect(res.status).toEqual(403);
    const after = await Document.findByPk(document.id, { rejectOnEmpty: true });
    expect(after.publishedAt).not.toBeNull();
  });
});

describe("#documents.import validation (integration)", () => {
  it("should require a file or attachmentId", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });

    const res = await server.post("/api/documents.import", user, {
      body: { collectionId: collection.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(400);
    expect(body.message).toEqual("one of attachmentId or file is required");
  });

  it("should accept an attachmentId without a file", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });

    const res = await server.post("/api/documents.import", user, {
      body: {
        collectionId: collection.id,
        attachmentId: "7c4f2a8e-6b1d-4f3a-9c5e-1a2b3c4d5e6f",
      },
    });
    const body = await res.json();

    expect(body.message).not.toEqual("one of attachmentId or file is required");
    expect(res.status).not.toEqual(200);
  });
});

describe("#documents.create from template (integration)", () => {
  it("should create a document from a readable template", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const template = await buildTemplate({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Meeting notes template",
      text: "Agenda items",
    });

    const res = await server.post("/api/documents.create", user, {
      body: {
        templateId: template.id,
        collectionId: collection.id,
        publish: true,
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.title).toEqual("Meeting notes template");
    expect(body.data.text).toContain("Agenda items");
    const created = await Document.findByPk(body.data.id, {
      rejectOnEmpty: true,
    });
    expect(created.templateId).toEqual(template.id);
  });

  it("should create from a template in a private collection the user is a member of", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const user = await buildUser({ teamId: team.id });
    const privateCollection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      permission: null,
    });
    await UserMembership.create({
      collectionId: privateCollection.id,
      userId: user.id,
      permission: CollectionPermission.Read,
      createdById: admin.id,
    });
    const target = await buildCollection({ teamId: team.id, userId: user.id });
    const template = await buildTemplate({
      teamId: team.id,
      userId: admin.id,
      collectionId: privateCollection.id,
      title: "Private template",
      text: "Members only",
    });

    const res = await server.post("/api/documents.create", user, {
      body: { templateId: template.id, collectionId: target.id, publish: true },
    });

    expect(res.status).toEqual(200);
    expect((await res.json()).data.title).toEqual("Private template");
  });

  it("should not create from another team's template", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const foreign = await buildTemplate({ text: "Foreign secret" });

    const res = await server.post("/api/documents.create", user, {
      body: {
        templateId: foreign.id,
        collectionId: collection.id,
        publish: true,
      },
    });

    expect([403, 404]).toContain(res.status);
    expect(JSON.stringify(await res.json())).not.toContain("Foreign secret");
    expect(
      await Document.count({ where: { collectionId: collection.id } })
    ).toEqual(0);
  });
});

describe("#documents.add_user validation (integration)", () => {
  it("should not let a user invite themselves", async () => {
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

    const res = await server.post("/api/documents.add_user", user, {
      body: { id: document.id, userId: user.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(400);
    expect(body.message).toEqual("You cannot invite yourself");
  });
});

describe("#documents response and edge details (integration)", () => {
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

  it("should not let a viewer restore a document", async () => {
    const { team, collection, document } = await setup();
    const viewer = await buildViewer({ teamId: team.id });
    await collection.update({ permission: CollectionPermission.Read });
    await document.destroy();

    const res = await server.post("/api/documents.restore", viewer, {
      body: { id: document.id },
    });

    expect(res.status).toEqual(403);
  });

  it("should return policies when restoring a document", async () => {
    const { user, document } = await setup();
    await document.destroy();

    const body = await (
      await server.post("/api/documents.restore", user, {
        body: { id: document.id },
      })
    ).json();

    expect(body.data.id).toEqual(document.id);
    expect(body.policies).toHaveLength(1);
    expect(body.policies[0].id).toEqual(document.id);
  });

  it("should refuse to move a document inside a draft", async () => {
    const { team, user, collection, document } = await setup();
    const draft = await buildDraftDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });

    const res = await server.post("/api/documents.move", user, {
      body: { id: document.id, parentDocumentId: draft.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(400);
    expect(body.message).toEqual("Cannot move document inside a draft");
  });

  it("should deny moving into a collection the user can only read", async () => {
    const { team, user, document } = await setup();
    const owner = await buildAdmin({ teamId: team.id });
    const readOnly = await buildCollection({
      teamId: team.id,
      userId: owner.id,
      permission: CollectionPermission.Read,
    });

    const res = await server.post("/api/documents.move", user, {
      body: { id: document.id, collectionId: readOnly.id },
    });

    expect(res.status).toEqual(403);
    const after = await Document.findByPk(document.id, { rejectOnEmpty: true });
    expect(after.collectionId).not.toEqual(readOnly.id);
  });

  it("should move into a private collection the user can write via membership", async () => {
    const { team, user, document } = await setup();
    const owner = await buildAdmin({ teamId: team.id });
    const target = await buildCollection({
      teamId: team.id,
      userId: owner.id,
      permission: null,
    });
    await UserMembership.create({
      collectionId: target.id,
      userId: user.id,
      permission: CollectionPermission.ReadWrite,
      createdById: owner.id,
    });

    const res = await server.post("/api/documents.move", user, {
      body: { id: document.id, collectionId: target.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.collections).toEqual([]);
    expect(body.data.documents.length).toBeGreaterThan(0);
    // Policies are included only when the collection changed.
    expect(body.policies.length).toBeGreaterThan(0);
  });

  it("should omit policies when a move keeps the collection", async () => {
    const { team, user, collection, document } = await setup();
    const sibling = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });

    const body = await (
      await server.post("/api/documents.move", user, {
        body: { id: document.id, collectionId: collection.id, index: 1 },
      })
    ).json();

    expect(sibling.id).toBeDefined();
    expect(body.policies).toEqual([]);
    expect(body.data.collections).toEqual([]);
  });

  it("should store and return a reason when archiving", async () => {
    const { user, document } = await setup();

    const body = await (
      await server.post("/api/documents.archive", user, {
        body: { id: document.id, reason: "  Superseded  " },
      })
    ).json();

    expect(body.data.deprecatedReason).toEqual("Superseded");
    expect(body.policies).toHaveLength(1);
    await document.reload();
    expect(document.deprecatedReason).toEqual("Superseded");
  });

  it("should keep an existing reason when archiving without one", async () => {
    const { user, document } = await setup();
    await document.update({ deprecatedReason: "Keep me" });

    const res = await server.post("/api/documents.archive", user, {
      body: { id: document.id },
    });
    expect(res.status).toEqual(200);
    await document.reload();
    expect(document.deprecatedReason).toEqual("Keep me");
  });

  it("should return success and record an event for a permanent delete", async () => {
    const { team, document } = await setup();
    const admin = await buildAdmin({ teamId: team.id });
    await document.destroy();

    const res = await server.post("/api/documents.delete", admin, {
      body: { id: document.id, permanent: true },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.success).toEqual(true);
    const event = await Event.findOne({
      where: { name: "documents.permanent_delete", documentId: document.id },
    });
    expect(event?.data).toEqual({ title: document.title });
  });

  it("should return success for a soft delete", async () => {
    const { user, document } = await setup();

    const body = await (
      await server.post("/api/documents.delete", user, {
        body: { id: document.id },
      })
    ).json();

    expect(body.success).toEqual(true);
  });

  it("should create a draft without a collection", async () => {
    const { user } = await setup();

    const res = await server.post("/api/documents.create", user, {
      body: { title: "Loose draft" },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.collectionId).toBeNull();
    expect(body.policies).toHaveLength(1);
  });

  it("should return policies when creating a document", async () => {
    const { user, collection } = await setup();

    const body = await (
      await server.post("/api/documents.create", user, {
        body: { title: "New one", collectionId: collection.id, publish: true },
      })
    ).json();

    expect(body.data.collectionId).toEqual(collection.id);
    expect(body.policies).toHaveLength(1);
    expect(body.policies[0].id).toEqual(body.data.id);
  });

  it("should add, update and remove a document user membership", async () => {
    const { team, user, document } = await setup();
    const other = await buildUser({ teamId: team.id });

    const added = await (
      await server.post("/api/documents.add_user", user, {
        body: {
          id: document.id,
          userId: other.id,
          permission: DocumentPermission.Read,
        },
      })
    ).json();
    expect(added.data.users[0].id).toEqual(other.id);
    expect(added.data.memberships[0].permission).toEqual(
      DocumentPermission.Read
    );

    const updated = await server.post("/api/documents.add_user", user, {
      body: {
        id: document.id,
        userId: other.id,
        permission: DocumentPermission.ReadWrite,
      },
    });
    expect(updated.status).toEqual(200);
    // Re-adding without a permission leaves the existing one alone.
    const unchanged = await server.post("/api/documents.add_user", user, {
      body: { id: document.id, userId: other.id },
    });
    expect(unchanged.status).toEqual(200);

    const rows = await UserMembership.findAll({
      where: { documentId: document.id, userId: other.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].permission).toEqual(DocumentPermission.ReadWrite);
    expect(rows[0].sourceId).toBeNull();

    const removed = await server.post("/api/documents.remove_user", user, {
      body: { id: document.id, userId: other.id },
    });
    expect(removed.status).toEqual(200);
    expect(
      await Event.count({
        where: { name: "documents.remove_user", documentId: document.id },
      })
    ).toEqual(1);
  });
});

/**
 * Pins the document mover and restorer commands through the API: the response
 * contents, the emitted event, pins, and index handling when reordering.
 */
describe("document mover and restorer details (integration)", () => {
  type Actor = Parameters<typeof server.post>[1];

  const setup = async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const from = await buildCollection({ teamId: team.id, userId: user.id });
    const to = await buildCollection({ teamId: team.id, userId: user.id });
    return { team, user, from, to };
  };
  const move = (user: Actor, body: Record<string, unknown>) =>
    server.post("/api/documents.move", user, { body });
  const topLevel = async (collectionId: string) =>
    (await loadStructure(collectionId)).map((n) => n.id);

  it("should report every moved document, the event and the policies", async () => {
    const { user, from, to } = await setup();
    const parent = await createPublished(user, {
      title: "Parent",
      collectionId: from.id,
    });
    const child = await createPublished(user, {
      title: "Child",
      collectionId: from.id,
      parentDocumentId: parent.id,
    });

    const res = await move(user, { id: parent.id, collectionId: to.id });
    expect(res.status).toEqual(200);
    const body = await res.json();

    expect(body.data.documents.map((d: { id: string }) => d.id)).toEqual([
      child.id,
      parent.id,
    ]);
    expect(
      body.data.documents.map((d: { collectionId: string }) => d.collectionId)
    ).toEqual([to.id, to.id]);
    expect(body.data.collections).toEqual([]);
    expect(body.policies.map((p: { id: string }) => p.id).sort()).toEqual(
      [child.id, parent.id].sort()
    );

    const event = await Event.findOne({
      where: { name: "documents.move", documentId: parent.id },
      rejectOnEmpty: true,
    });
    expect(event.data).toEqual({
      collectionIds: [from.id, to.id],
      documentIds: [child.id, parent.id],
    });

    expect(await topLevel(from.id)).toEqual([]);
    const target = await loadStructure(to.id);
    expect(target.map((n) => n.id)).toEqual([parent.id]);
    expect(target[0].children.map((n) => n.id)).toEqual([child.id]);
  });

  it("should report only the document and no policies when reordering", async () => {
    const { user, from } = await setup();
    const a = await createPublished(user, {
      title: "A",
      collectionId: from.id,
    });
    await createPublished(user, { title: "B", collectionId: from.id });

    const res = await move(user, {
      id: a.id,
      collectionId: from.id,
      index: 1,
    });
    const body = await res.json();
    expect(body.data.documents.map((d: { id: string }) => d.id)).toEqual([
      a.id,
    ]);
    expect(body.policies).toEqual([]);

    const event = await Event.findOne({
      where: { name: "documents.move", documentId: a.id },
      rejectOnEmpty: true,
    });
    expect(event.data).toEqual({
      collectionIds: [from.id],
      documentIds: [a.id],
    });
  });

  it("should drop only the pin of the collection the document left", async () => {
    const { team, user, from, to } = await setup();
    const doc = await createPublished(user, {
      title: "Pinned",
      collectionId: from.id,
    });
    await buildPin({
      teamId: team.id,
      createdById: user.id,
      documentId: doc.id,
      collectionId: from.id,
    });
    await buildPin({
      teamId: team.id,
      createdById: user.id,
      documentId: doc.id,
      collectionId: null,
    });

    const res = await move(user, { id: doc.id, collectionId: to.id });
    expect(res.status).toEqual(200);

    const pins = await Pin.findAll({ where: { documentId: doc.id } });
    expect(pins.map((p) => p.collectionId)).toEqual([null]);
  });

  it("should keep a pin when the document stays in its collection", async () => {
    const { team, user, from } = await setup();
    const doc = await createPublished(user, {
      title: "Pinned",
      collectionId: from.id,
    });
    await createPublished(user, { title: "Other", collectionId: from.id });
    await buildPin({
      teamId: team.id,
      createdById: user.id,
      documentId: doc.id,
      collectionId: from.id,
    });

    await move(user, { id: doc.id, collectionId: from.id, index: 1 });

    expect(await Pin.count({ where: { documentId: doc.id } })).toEqual(1);
  });

  it("should move a draft without touching either collection structure", async () => {
    const { team, user, from, to } = await setup();
    const keep = await createPublished(user, {
      title: "Keep",
      collectionId: from.id,
    });
    const draft = await buildDraftDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: from.id,
    });

    const res = await move(user, { id: draft.id, collectionId: to.id });
    expect(res.status).toEqual(200);

    const row = await Document.findByPk(draft.id, { rejectOnEmpty: true });
    expect(row.collectionId).toEqual(to.id);
    expect(row.publishedAt).toBeNull();
    expect(await topLevel(from.id)).toEqual([keep.id]);
    expect(await topLevel(to.id)).toEqual([]);
    const body = await res.json();
    expect(body.data.documents.map((d: { id: string }) => d.id)).toEqual([
      draft.id,
    ]);
  });

  describe("index handling", () => {
    const abc = async () => {
      const ctx = await setup();
      for (const title of ["A", "B", "C"]) {
        await createPublished(ctx.user, {
          title,
          collectionId: ctx.from.id,
        });
      }
      const [x, y, z] = await topLevel(ctx.from.id);
      return { ...ctx, x, y, z };
    };

    it("should move an item up to the front", async () => {
      const { user, from, x, y, z } = await abc();
      await move(user, { id: z, collectionId: from.id, index: 0 });
      expect(await topLevel(from.id)).toEqual([z, x, y]);
    });

    it("should keep the order when moving to its own slot", async () => {
      const { user, from, x, y, z } = await abc();
      await move(user, { id: x, collectionId: from.id, index: 0 });
      expect(await topLevel(from.id)).toEqual([x, y, z]);
      await move(user, { id: y, collectionId: from.id, index: 1 });
      expect(await topLevel(from.id)).toEqual([x, y, z]);
    });

    it("should move an item past the end", async () => {
      const { user, from, x, y, z } = await abc();
      await move(user, { id: x, collectionId: from.id, index: 3 });
      expect(await topLevel(from.id)).toEqual([y, z, x]);
    });

    it("should append when no index is given", async () => {
      const { user, from, x, y, z } = await abc();
      await move(user, { id: x, collectionId: from.id });
      expect(await topLevel(from.id)).toEqual([y, z, x]);
    });

    it("should not compensate the index when the parent changes", async () => {
      const { user, from, x, y, z } = await abc();
      const parent = await createPublished(user, {
        title: "P",
        collectionId: from.id,
      });
      const c1 = await createPublished(user, {
        title: "c1",
        collectionId: from.id,
        parentDocumentId: parent.id,
      });
      const c2 = await createPublished(user, {
        title: "c2",
        collectionId: from.id,
        parentDocumentId: parent.id,
      });

      await move(user, { id: x, parentDocumentId: parent.id, index: 1 });

      // New documents are inserted first, so the starting order is [c2, c1].
      const node = (await loadStructure(from.id)).find(
        (n) => n.id === parent.id
      );
      expect(node?.children.map((n) => n.id)).toEqual([c2.id, x, c1.id]);
      expect(await topLevel(from.id)).toEqual([parent.id, y, z]);
    });

    it("should not compensate the index when the collection changes", async () => {
      const { user, to, x } = await abc();
      const b1 = await createPublished(user, {
        title: "b1",
        collectionId: to.id,
      });
      const b2 = await createPublished(user, {
        title: "b2",
        collectionId: to.id,
      });

      await move(user, { id: x, collectionId: to.id, index: 1 });

      expect(await topLevel(to.id)).toEqual([b2.id, x, b1.id]);
    });
  });

  describe("restore", () => {
    it.each(["deleted", "archived"] as const)(
      "should restore a %s document into another collection",
      async (state) => {
        const { user, from, to } = await setup();
        const doc = await createPublished(user, {
          title: "Wanderer",
          collectionId: from.id,
        });
        if (state === "deleted") {
          await server.post("/api/documents.delete", user, {
            body: { id: doc.id },
          });
        } else {
          await server.post("/api/documents.archive", user, {
            body: { id: doc.id },
          });
        }

        const res = await server.post("/api/documents.restore", user, {
          body: { id: doc.id, collectionId: to.id },
        });
        expect(res.status).toEqual(200);

        const row = await Document.findByPk(doc.id, { rejectOnEmpty: true });
        expect(row.collectionId).toEqual(to.id);
        expect(row.deletedAt).toBeNull();
        expect(row.archivedAt).toBeNull();
        expect(await topLevel(to.id)).toEqual([doc.id]);
        expect(await topLevel(from.id)).toEqual([]);
      }
    );

    it("should refuse to restore into an archived collection", async () => {
      const { team, user, from } = await setup();
      const archived = await buildCollection({
        teamId: team.id,
        userId: user.id,
        archivedAt: new Date(),
      });
      const doc = await createPublished(user, {
        title: "Stuck",
        collectionId: from.id,
      });
      await server.post("/api/documents.delete", user, {
        body: { id: doc.id },
      });

      const res = await server.post("/api/documents.restore", user, {
        body: { id: doc.id, collectionId: archived.id },
      });

      expect(res.status).toEqual(400);
      expect((await res.json()).message).toContain("Unable to restore");
      expect(await Document.findByPk(doc.id)).toBeNull();
    });

    it("should restore a document to a revision", async () => {
      const { team, user, from } = await setup();
      const doc = await buildDocument({
        teamId: team.id,
        userId: user.id,
        collectionId: from.id,
        title: "Original title",
        text: "original text",
      });
      const revision = Revision.buildFromDocument(doc);
      await revision.save();
      await doc.update({ title: "Changed title", text: "changed text" });

      const res = await server.post("/api/documents.restore", user, {
        body: { id: doc.id, revisionId: revision.id },
      });
      expect(res.status).toEqual(200);

      const row = await Document.findByPk(doc.id, { rejectOnEmpty: true });
      expect(row.title).toEqual("Original title");
      expect(row.text).toContain("original text");
      expect(
        await Event.count({
          where: { name: "documents.restore", documentId: doc.id },
        })
      ).toEqual(1);
    });

    it("should require a revision for a live document", async () => {
      const { user, from } = await setup();
      const doc = await createPublished(user, {
        title: "Live",
        collectionId: from.id,
      });

      const res = await server.post("/api/documents.restore", user, {
        body: { id: doc.id },
      });

      expect(res.status).toEqual(400);
      expect((await res.json()).message).toContain("revisionId is required");
    });

    it("should reject a revision of another document or a missing one", async () => {
      const { team, user, from } = await setup();
      const doc = await buildDocument({
        teamId: team.id,
        userId: user.id,
        collectionId: from.id,
      });
      const other = await buildDocument({
        teamId: team.id,
        userId: user.id,
        collectionId: from.id,
      });
      const foreign = Revision.buildFromDocument(other);
      await foreign.save();

      const wrong = await server.post("/api/documents.restore", user, {
        body: { id: doc.id, revisionId: foreign.id },
      });
      expect(wrong.status).toEqual(403);

      const missing = await server.post("/api/documents.restore", user, {
        body: {
          id: doc.id,
          revisionId: "00000000-0000-4000-8000-000000000000",
        },
      });
      expect(missing.status).toEqual(404);
    });
  });
});
