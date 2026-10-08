import { createHash } from "crypto";
import path from "path";

import { Logger } from "@nestjs/common";

/** The `vector(384)` columns (DocumentChunk, EventEmbedding). Every embedder must produce this many numbers. */
export const EMBEDDING_DIMENSIONS = 384;

/**
 * Text → unit vectors for similarity search (PLANDIT-22). `model` is stored with every vector: vectors from different
 * models are not comparable, so search only uses rows of the current model and the worker redoes the rest.
 * Both implementations are free: nothing here calls a paid API.
 */
export interface EmbeddingClient {
  readonly model: string;
  /** "query" for what someone asks, "passage" for what is stored (e5 models embed the two differently) */
  embed(texts: string[], kind: "query" | "passage"): Promise<number[][]>;
}

export const EMBEDDING_CLIENT = Symbol("EMBEDDING_CLIENT");

const LOCAL_MODEL = "Xenova/multilingual-e5-small";
const BATCH = 32;

/**
 * A small multilingual model (Korean included) run on the CPU through ONNX Runtime. The quantized weights (about
 * 120MB) are downloaded from Hugging Face on first use into EMBEDDING_CACHE_DIR and reused after that.
 */
export class LocalEmbeddingAdapter implements EmbeddingClient {
  readonly model = "multilingual-e5-small";
  private readonly logger = new Logger(LocalEmbeddingAdapter.name);
  private extractor?: Promise<(texts: string[], options: object) => Promise<{ tolist(): number[][] }>>;

  constructor(private readonly cacheDir: string) {}

  private load() {
    this.extractor ??= (async () => {
      const started = Date.now();
      const { env, pipeline } = await import("@huggingface/transformers");
      env.cacheDir = this.cacheDir;
      const extractor = await pipeline("feature-extraction", LOCAL_MODEL, { dtype: "q8" });
      this.logger.log({ model: LOCAL_MODEL, ms: Date.now() - started, cacheDir: this.cacheDir }, "Embedding model loaded");
      return extractor as unknown as (texts: string[], options: object) => Promise<{ tolist(): number[][] }>;
    })().catch((error: unknown) => {
      this.extractor = undefined; // a failed download is tried again on the next call
      throw error;
    });
    return this.extractor;
  }

  async embed(texts: string[], kind: "query" | "passage") {
    const extract = await this.load();
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH).map((text) => `${kind}: ${text}`);
      vectors.push(...(await extract(batch, { pooling: "mean", normalize: true })).tolist());
    }
    return vectors;
  }
}

/**
 * Offline stand-in for tests and CI (EMBEDDING_PROVIDER=hash): character 2- and 3-grams hashed into the same
 * dimensions, normalised. Deterministic and instant; it finds shared words ("A사"), not meaning.
 */
export class HashEmbeddingAdapter implements EmbeddingClient {
  readonly model = "hash-ngram-384";

  async embed(texts: string[]) {
    return texts.map(hashEmbedding);
  }
}

export function hashEmbedding(text: string) {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const chars = [...text.toLowerCase().replace(/\s+/g, " ").trim()];
  for (const n of [2, 3]) {
    for (let i = 0; i + n <= chars.length; i++) {
      const digest = createHash("md5").update(chars.slice(i, i + n).join("")).digest();
      vector[digest.readUInt32LE(0) % EMBEDDING_DIMENSIONS] += digest[4] & 1 ? 1 : -1;
    }
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((x) => x / norm);
}

/** EMBEDDING_PROVIDER picks the embedder: `local` (default) or `hash`. */
export function embeddingClientFromEnv(): EmbeddingClient {
  const provider = process.env.EMBEDDING_PROVIDER ?? "local";
  if (provider === "hash") return new HashEmbeddingAdapter();
  if (provider === "local") return new LocalEmbeddingAdapter(process.env.EMBEDDING_CACHE_DIR || path.resolve(process.cwd(), "../../.cache/models"));
  throw new Error(`Unknown EMBEDDING_PROVIDER: ${provider}`);
}

/** pgvector's text form, for `${toVector(v)}::vector` in a raw query */
export const toVector = (vector: number[]) => `[${vector.join(",")}]`;
