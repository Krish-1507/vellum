export type OutlineEntry = {
  heading: string;
  page: number;
  charStart: number;
  charEnd: number;
};

export type ExtractedClause = {
  kind: string;
  label: string;
  page: number;
  excerpt: string;
  charStart: number;
  charEnd: number;
};

export type AgentActivity = {
  kind: "search" | "section" | "pages" | "clauses" | "note";
  label: string;
  detail?: string;
};

export type ComparisonChange = {
  id: string;
  changeType: string;
  significance: string;
  significanceScore: number;
  title: string;
  explanation: string;
  leftText: string | null;
  rightText: string | null;
  leftPage: number | null;
  rightPage: number | null;
};

export type DocumentSummary = {
  id: string;
  name: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  kind: string;
  status: string;
  errorMessage: string | null;
  pageCount: number;
  charCount: number;
  outline: OutlineEntry[];
  clauses: ExtractedClause[];
  hasHtml: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CitationView = {
  id: string;
  documentId: string;
  quoteText: string;
  verified: boolean;
  pageNumber: number | null;
  pageEnd: number | null;
  charStart: number | null;
  charEnd: number | null;
  occurrence: number;
  totalOccurrences: number;
};

export type SerializedMessage = {
  id: string;
  role: string;
  content: string;
  status: string;
  coverage: string | null;
  coverageNote: string | null;
  activity: AgentActivity[];
  createdAt: string;
  citations: CitationView[];
  droppedUnverified: number;
};
