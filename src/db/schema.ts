import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import type { AgentActivity, ExtractedClause, OutlineEntry } from "@/lib/types";

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    storagePath: text("storage_path").notNull(),
    kind: text("kind").notNull(), // pdf | docx
    status: text("status").notNull().default("queued"),
    // queued | processing | ready | failed
    errorMessage: text("error_message"),
    pageCount: integer("page_count").notNull().default(0),
    charCount: integer("char_count").notNull().default(0),
    extractedText: text("extracted_text").notNull().default(""),
    htmlContent: text("html_content"),
    outlineJson: jsonb("outline_json").$type<OutlineEntry[]>().notNull().default(sql`'[]'::jsonb`),
    clausesJson: jsonb("clauses_json").$type<ExtractedClause[]>().notNull().default(sql`'[]'::jsonb`),
    coverageNote: text("coverage_note"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("documents_created_idx").on(table.createdAt)],
);

export const documentPages = pgTable(
  "document_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    text: text("text").notNull(),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
  },
  (table) => [index("document_pages_doc_idx").on(table.documentId)],
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    heading: text("heading"),
    text: text("text").notNull(),
    pageStart: integer("page_start").notNull(),
    pageEnd: integer("page_end").notNull(),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
  },
  (table) => [index("document_chunks_doc_idx").on(table.documentId)],
);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull().default("Untitled"),
  mode: text("mode").notNull().default("single"), // single | multi
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

export const conversationDocuments = pgTable(
  "conversation_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("conversation_documents_conv_idx").on(table.conversationId),
    index("conversation_documents_doc_idx").on(table.documentId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // user | assistant
    content: text("content").notNull().default(""),
    status: text("status").notNull().default("complete"), // streaming | complete | stopped | error
    coverage: text("coverage"), // full | partial
    coverageNote: text("coverage_note"),
    activityJson: jsonb("activity_json").$type<AgentActivity[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("messages_conv_idx").on(table.conversationId)],
);

export const messageCitations = pgTable(
  "message_citations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    quoteText: text("quote_text").notNull(),
    verified: boolean("verified").notNull().default(false),
    displayText: text("display_text"),
    pageNumber: integer("page_number"),
    pageEnd: integer("page_end"),
    charStart: integer("char_start"),
    charEnd: integer("char_end"),
    occurrence: integer("occurrence").notNull().default(0),
    totalOccurrences: integer("total_occurrences").notNull().default(0),
    omitted: boolean("omitted").notNull().default(false),
  },
  (table) => [index("message_citations_msg_idx").on(table.messageId)],
);

export const comparisons = pgTable("comparisons", {
  id: uuid("id").primaryKey().defaultRandom(),
  leftDocumentId: uuid("left_document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  rightDocumentId: uuid("right_document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  summary: text("summary").notNull().default(""),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const comparisonChanges = pgTable(
  "comparison_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    comparisonId: uuid("comparison_id")
      .notNull()
      .references(() => comparisons.id, { onDelete: "cascade" }),
    changeType: text("change_type").notNull(), // added | removed | modified | reworded
    significance: text("significance").notNull(), // high | medium | low
    significanceScore: integer("significance_score").notNull().default(0),
    title: text("title").notNull(),
    explanation: text("explanation").notNull(),
    leftText: text("left_text"),
    rightText: text("right_text"),
    leftPage: integer("left_page"),
    rightPage: integer("right_page"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("comparison_changes_cmp_idx").on(table.comparisonId)],
);

export type DocumentRow = typeof documents.$inferSelect;
export type DocumentPageRow = typeof documentPages.$inferSelect;
export type DocumentChunkRow = typeof documentChunks.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type CitationRow = typeof messageCitations.$inferSelect;
export type ComparisonRow = typeof comparisons.$inferSelect;
export type ComparisonChangeRow = typeof comparisonChanges.$inferSelect;
