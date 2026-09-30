/** Transport framing only; each line contains one already encoded semantic record. */
export class EchoHttpRecordError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); }
}

export async function read_echo_http_records_internal(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxRecordBytes: number,
  onRecord: (record: string) => void | Promise<void>,
): Promise<void> {
  let decoder = new TextDecoder("utf-8", { fatal: true });
  let line = "";
  let bytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) {
      if (bytes !== 0) throw new EchoHttpRecordError("HTTP Echo stream ended mid-record.");
      return;
    }
    const chunk = next.value;
    let begin = 0;
    for (let index = 0; index < chunk.byteLength; index += 1) {
      if (chunk[index] !== 10) continue;
      bytes += index - begin;
      if (bytes > maxRecordBytes) throw new EchoHttpRecordError("HTTP Echo stream record exceeds its byte limit.");
      try {
        line += decoder.decode(chunk.subarray(begin, index), { stream: true });
        line += decoder.decode();
        await onRecord(line);
      } catch (cause) {
        throw new EchoHttpRecordError("HTTP Echo stream record is invalid.", { cause });
      }
      decoder = new TextDecoder("utf-8", { fatal: true });
      line = "";
      bytes = 0;
      begin = index + 1;
    }
    bytes += chunk.byteLength - begin;
    if (bytes > maxRecordBytes) throw new EchoHttpRecordError("HTTP Echo stream record exceeds its byte limit.");
    try { line += decoder.decode(chunk.subarray(begin), { stream: true }); }
    catch (cause) { throw new EchoHttpRecordError("HTTP Echo stream contains invalid UTF-8.", { cause }); }
  }
}
