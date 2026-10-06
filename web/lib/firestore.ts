// Firestore, as far as the app needs it, spoken to over its REST interface: no library, and
// nothing to bundle. The server runs as a service account (Firebase App Hosting gives it one);
// its token comes from the metadata server every Google Cloud machine has. Server only.
//
// Elsewhere — on a developer's machine, in the tests — there is no such account: there the app
// keeps what it would keep here in memory (lib/store.ts).

const META = "http://metadata.google.internal/computeMetadata/v1";
let token: { value: string; until: number } | null = null;
let project: string | null = null;

/** Whether this server has a Firestore to speak to. */
export const here = () => !!(process.env.K_SERVICE || process.env.FIRESTORE_FORCE) && process.env.STORE !== "memory";

async function meta(path: string): Promise<string> {
  const res = await fetch(`${META}/${path}`, { headers: { "Metadata-Flavor": "Google" }, cache: "no-store" });
  if (!res.ok) throw new Error(`metadata: ${res.status}`);
  return res.text();
}
async function access(): Promise<string> {
  if (token && token.until - Date.now() > 60_000) return token.value;
  const said = JSON.parse(await meta("instance/service-accounts/default/token")) as { access_token: string; expires_in: number };
  token = { value: said.access_token, until: Date.now() + said.expires_in * 1000 };
  return token.value;
}
async function root(): Promise<string> {
  if (!project) {
    try { project = JSON.parse(process.env.FIREBASE_CONFIG || "{}").projectId || null; } catch { /* (not there) */ }
    project = project || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || (await meta("project/project-id"));
  }
  return `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
}

// a document's fields, as Firestore writes values, and back
export type Plain = Record<string, string | number | boolean | null>;
type Value = { stringValue?: string; integerValue?: string; booleanValue?: boolean; nullValue?: null; doubleValue?: number };
const wrap = (v: Plain[string]): Value => (v === null ? { nullValue: null } : typeof v === "string" ? { stringValue: v } : typeof v === "boolean" ? { booleanValue: v } : Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v });
const unwrap = (v: Value): Plain[string] => ("stringValue" in v ? v.stringValue! : "integerValue" in v ? Number(v.integerValue) : "booleanValue" in v ? v.booleanValue! : "doubleValue" in v ? v.doubleValue! : null);
const fields = (data: Plain) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, wrap(v)]));
const plain = (doc: { fields?: Record<string, Value> }): Plain => Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, unwrap(v)]));
const idOf = (name: string) => decodeURIComponent(name.slice(name.lastIndexOf("/") + 1));

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch((await root()) + path, { method, headers: { Authorization: `Bearer ${await access()}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
}
const at = (collection: string, id: string) => `/${collection}/${encodeURIComponent(id)}`;

/** A document, or null. */
export async function get(collection: string, id: string): Promise<Plain | null> {
  const res = await call("GET", at(collection, id));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`firestore get: ${res.status}`);
  return plain(await res.json());
}
/** These fields of a document set (the others stay); the document is made if it is not there. */
export async function set(collection: string, id: string, data: Plain): Promise<void> {
  const mask = Object.keys(data).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const res = await call("PATCH", `${at(collection, id)}?${mask}`, { fields: fields(data) });
  if (!res.ok) throw new Error(`firestore set: ${res.status}`);
}
/** A document made — only if none of that name is there. → whether it was made. */
export async function create(collection: string, id: string, data: Plain): Promise<boolean> {
  const res = await call("POST", `/${collection}?documentId=${encodeURIComponent(id)}`, { fields: fields(data) });
  if (res.status === 409) return false;
  if (!res.ok) throw new Error(`firestore create: ${res.status}`);
  return true;
}
export async function remove(collection: string, id: string): Promise<void> {
  const res = await call("DELETE", at(collection, id));
  if (!res.ok && res.status !== 404) throw new Error(`firestore delete: ${res.status}`);
}
/** The documents in which a field is one of some values (at most 30 of them): [id, fields]. */
export async function where(collection: string, field: string, values: string[]): Promise<[string, Plain][]> {
  if (!values.length) return [];
  const res = await call("POST", ":runQuery", { structuredQuery: { from: [{ collectionId: collection }], where: { fieldFilter: { field: { fieldPath: field }, op: "IN", value: { arrayValue: { values: values.slice(0, 30).map((v) => ({ stringValue: v })) } } } }, limit: 2000 } });
  if (!res.ok) throw new Error(`firestore query: ${res.status}`);
  return ((await res.json()) as { document?: { name: string; fields?: Record<string, Value> } }[]).filter((r) => r.document).map((r) => [idOf(r.document!.name), plain(r.document!)]);
}
/** How many documents have a field at a value. */
export async function count(collection: string, field: string, value: string): Promise<number> {
  const res = await call("POST", ":runAggregationQuery", { structuredAggregationQuery: { aggregations: [{ alias: "n", count: {} }], structuredQuery: { from: [{ collectionId: collection }], where: { fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: { stringValue: value } } } } } });
  if (!res.ok) throw new Error(`firestore count: ${res.status}`);
  const said = (await res.json()) as { result?: { aggregateFields?: { n?: { integerValue?: string } } } }[];
  return Number(said[0]?.result?.aggregateFields?.n?.integerValue || 0);
}
/** A number in a document one more, and other fields set, in one write. (Nothing where the document is not there.) */
export async function bump(collection: string, id: string, field: string, data: Plain): Promise<void> {
  const name = `${(await root()).replace("https://firestore.googleapis.com/v1/", "")}${at(collection, id)}`;
  const res = await call("POST", ":commit", { writes: [{ update: { name, fields: fields(data) }, updateMask: { fieldPaths: Object.keys(data) }, updateTransforms: [{ fieldPath: field, increment: { integerValue: "1" } }], currentDocument: { exists: true } }] });
  if (!res.ok && res.status !== 404 && res.status !== 400) throw new Error(`firestore bump: ${res.status}`);
}
