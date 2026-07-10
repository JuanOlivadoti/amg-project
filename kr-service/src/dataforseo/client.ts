import { config } from "../config.js";

/**
 * Cliente DataForSEO (Basic Auth). Arranca contra sandbox.
 * Acumula el costo reportado por la API (`cost`) para el presupuesto del run.
 */
export class DataForSeoClient {
  private authHeader: string;
  public costUsd = 0; // acumulado del run (en USD; la API devuelve `cost` por task)

  constructor() {
    const { login, password } = config.dataforseo;
    this.authHeader =
      "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
  }

  get costMicros(): number {
    return Math.round(this.costUsd * 1_000_000);
  }

  /** POST a un endpoint /v3/... y devuelve tasks[].result acumulando costo. */
  async post<T = unknown>(path: string, body: unknown): Promise<T[]> {
    const url = `${config.dataforseo.baseUrl}${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`DataForSEO HTTP ${res.status} en ${path}: ${await res.text()}`);
    }

    const json = (await res.json()) as DfsResponse<T>;
    if (json.status_code !== 20000) {
      throw new Error(`DataForSEO status ${json.status_code}: ${json.status_message}`);
    }

    const results: T[] = [];
    for (const task of json.tasks ?? []) {
      if (typeof task.cost === "number") this.costUsd += task.cost;
      for (const r of task.result ?? []) results.push(r);
    }
    return results;
  }
}

interface DfsResponse<T> {
  status_code: number;
  status_message: string;
  tasks?: Array<{
    cost?: number;
    status_code?: number;
    result?: T[] | null;
  }>;
}
