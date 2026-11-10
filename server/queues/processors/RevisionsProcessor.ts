import isEqual from "fast-deep-equal";
import { createContext } from "@server/context";
import Redis from "@server/storage/redis";
import { Revision, Document, User } from "@server/models";
import { sequelize } from "@server/storage/database";
import type { DocumentEvent, RevisionEvent, Event } from "@server/types";
import DocumentUpdateTextTask from "../tasks/DocumentUpdateTextTask";
import BaseProcessor from "./BaseProcessor";

export default class RevisionsProcessor extends BaseProcessor {
  static applicableEvents: Event["name"][] = [
    "documents.publish",
    "documents.update",
    "documents.update.debounced",
  ];

  async perform(event: DocumentEvent | RevisionEvent) {
    switch (event.name) {
      case "documents.publish":
      case "documents.update.debounced":
      case "documents.update": {
        if (event.name === "documents.update" && !event.data?.done) {
          return;
        }

        // Only read attribution included in a persisted snapshot. Revisions
        // created from the API and legacy events have no cutoff and must not
        // consume pending edits.
        const sequence =
          event.data && "collaborators" in event.data
            ? event.data.collaborators
            : undefined;
        const key = Document.getCollaboratorKey(event.documentId);

        await sequelize.transaction(async (transaction) => {
          // Lock the document row so concurrent events for the same document
          // run the check-then-insert below one at a time. Without it both can
          // see "no previous revision" and each insert a duplicate.
          const document = await Document.findByPk(event.documentId, {
            paranoid: false,
            rejectOnEmpty: true,
            transaction,
            // `of` limits the lock to documents; the default scope left-joins users.
            lock: { level: transaction.LOCK.UPDATE, of: Document },
          });
          const previous = await Revision.findLatest(document.id, {
            transaction,
          });

          // we don't create revisions if identical to previous revision, this can happen if a manual
          // revision was created from another service or user.
          if (
            previous &&
            isEqual(document.content, previous.content) &&
            document.title === previous.title
          ) {
            return;
          }

          const collaboratorIds =
            sequence === undefined
              ? []
              : await Redis.defaultClient.zrangebyscore(key, "-inf", sequence);

          await new DocumentUpdateTextTask().schedule(event);

          const user = await User.findByPk(event.actorId, {
            paranoid: false,
            rejectOnEmpty: true,
            transaction,
          });

          await Revision.createFromDocument(
            createContext({
              user,
              authType: event.authType,
              ip: event.ip,
              transaction,
            }),
            document,
            collaboratorIds
          );
        });

        // The snapshot's edits are now in a revision (new or existing), so
        // consume their attribution. A subsequent edit by the same user has a
        // higher score and survives; on failure above, attribution stays intact.
        if (sequence !== undefined) {
          await Redis.defaultClient.zremrangebyscore(key, "-inf", sequence);
        }
        break;
      }

      default:
    }
  }
}
