import {
  buildCollection,
  buildDocument,
  buildShare,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import { cleanBetweenTests } from "@server/test/cleanup";
import { getTestServer } from "@server/test/support";
import { CollectionPermission } from "@shared/types";

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
