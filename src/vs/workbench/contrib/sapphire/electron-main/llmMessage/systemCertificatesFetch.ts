/*--------------------------------------------------------------------------------------
 *  HTTPS-агент для LLM-клиентов в electron-main: корни Node и системное хранилище CA.
 *--------------------------------------------------------------------------------------*/

import * as https from 'https';
import * as tls from 'tls';
import { loadSystemCertificates } from '@vscode/proxy-agent';
import type { Agent } from 'http';

const quietCertLog = {
  trace: (_message: string, ..._args: any[]) => {},
  debug: (_message: string, ..._args: any[]) => {},
  info: (_message: string, ..._args: any[]) => {},
  warn: (_message: string, ..._args: any[]) => {},
  error: (_message: string | Error, ..._args: any[]) => {},
};

let cachedHttpAgentPromise: Promise<Agent> | undefined;

/** HTTPS-агент: встроенные корни Node и системное хранилище CA. */
export async function getGatewayHttpAgentWithSystemCertificates(): Promise<Agent> {
  if (!cachedHttpAgentPromise) {
    cachedHttpAgentPromise = (async () => {
      let systemCAs: string[] = [];
      try {
        systemCAs = await loadSystemCertificates({ log: quietCertLog });
      } catch {
        // Системное хранилище — best-effort.
      }
      const ca = [...tls.rootCertificates, ...systemCAs];
      return new https.Agent({ ca, keepAlive: true });
    })();
  }
  return cachedHttpAgentPromise;
}

/**
 * true, если ошибка связана с TLS/сертификатом (не «просто офлайн» или DNS).
 * Обходит цепочку cause — OpenAI часто оборачивает это в APIConnectionError.
 */
export function isTlsCertificateError(error: unknown): boolean {
  const parts: string[] = [];
  let cur: unknown = error;
  for (let depth = 0; depth < 8 && cur; depth++) {
    if (typeof cur === 'string') {
      parts.push(cur);
      break;
    }
    if (typeof cur !== 'object') {
      break;
    }
    const obj = cur as { message?: unknown; code?: unknown; cause?: unknown; errors?: unknown };
    if (typeof obj.message === 'string') {
      parts.push(obj.message);
    }
    if (typeof obj.code === 'string') {
      parts.push(obj.code);
    }
    if (Array.isArray(obj.errors)) {
      for (const nested of obj.errors) {
        if (
          nested &&
          typeof nested === 'object' &&
          typeof (nested as { message?: unknown }).message === 'string'
        ) {
          parts.push((nested as { message: string }).message);
        }
        if (
          nested &&
          typeof nested === 'object' &&
          typeof (nested as { code?: unknown }).code === 'string'
        ) {
          parts.push((nested as { code: string }).code);
        }
      }
    }
    cur = obj.cause;
  }

  const blob = parts.join(' ');
  return /UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT|unable to get local issuer|unable to get issuer certificate|CERT_UNTRUSTED|CERT_HAS_EXPIRED|DEPTH_ZERO_SELF_SIGNED_CERT|self[- ]signed certificate|certificate verify failed|ERR_TLS|SSL alert number|unable to verify the first certificate/i.test(
    blob,
  );
}
