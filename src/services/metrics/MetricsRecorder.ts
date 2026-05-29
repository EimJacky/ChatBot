export interface MetricsSnapshot {
  requests: number;
  errors: number;
  usageWriteFailures: number;
  totalLatencyMs: number;
  llmLatencyMs: number;
  storeLatencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export class MetricsRecorder {
  private snapshot: MetricsSnapshot = {
    requests: 0,
    errors: 0,
    usageWriteFailures: 0,
    totalLatencyMs: 0,
    llmLatencyMs: 0,
    storeLatencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
  };

  recordRequest(elapsedMs: number): void {
    this.snapshot.requests += 1;
    this.snapshot.totalLatencyMs += elapsedMs;
  }

  recordError(): void {
    this.snapshot.errors += 1;
  }

  recordUsageWriteFailure(): void {
    this.snapshot.usageWriteFailures += 1;
  }

  recordLlmLatency(elapsedMs: number): void {
    this.snapshot.llmLatencyMs += elapsedMs;
  }

  recordStoreLatency(elapsedMs: number): void {
    this.snapshot.storeLatencyMs += elapsedMs;
  }

  recordTokens(inputTokens: number, outputTokens: number): void {
    this.snapshot.inputTokens += inputTokens;
    this.snapshot.outputTokens += outputTokens;
  }

  getSnapshot(): MetricsSnapshot {
    return { ...this.snapshot };
  }

  toPrometheus(): string {
    const snapshot = this.getSnapshot();
    const lines = [
      '# HELP echomate_requests_total Total successful chat replies.',
      '# TYPE echomate_requests_total counter',
      `echomate_requests_total ${snapshot.requests}`,
      '# HELP echomate_errors_total Total chat handling errors.',
      '# TYPE echomate_errors_total counter',
      `echomate_errors_total ${snapshot.errors}`,
      '# HELP echomate_usage_write_failures_total Total usage persistence failures.',
      '# TYPE echomate_usage_write_failures_total counter',
      `echomate_usage_write_failures_total ${snapshot.usageWriteFailures}`,
      '# HELP echomate_tokens_total Total estimated tokens by direction.',
      '# TYPE echomate_tokens_total counter',
      `echomate_tokens_total{direction="input"} ${snapshot.inputTokens}`,
      `echomate_tokens_total{direction="output"} ${snapshot.outputTokens}`,
      '# HELP echomate_latency_ms_total Cumulative latency in milliseconds by operation.',
      '# TYPE echomate_latency_ms_total counter',
      `echomate_latency_ms_total{operation="request"} ${snapshot.totalLatencyMs}`,
      `echomate_latency_ms_total{operation="llm"} ${snapshot.llmLatencyMs}`,
      `echomate_latency_ms_total{operation="store"} ${snapshot.storeLatencyMs}`,
    ];
    return `${lines.join('\n')}\n`;
  }
}
