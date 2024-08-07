/*
 * Copyright The OpenTelemetry Authors, Aspecto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {
  Attributes,
  Tracer,
  SpanStatusCode,
  diag,
  Span,
  SpanKind,
} from '@opentelemetry/api';
import { DbStatementSerializer, ResponseHook } from './types';
import { safeExecuteInTheMiddle } from '@opentelemetry/instrumentation';
import {
  SEMATTRS_DB_SYSTEM,
  SEMATTRS_NET_TRANSPORT,
  SEMATTRS_NET_PEER_NAME,
  SEMATTRS_NET_PEER_PORT,
} from '@opentelemetry/semantic-conventions';

interface StartSpanPayload {
  tracer: Tracer;
  attributes: Attributes;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getIndexName(params: any) {
  if (!params?.index) {
    return undefined;
  }

  if (typeof params.index === 'string') {
    return params.index;
  }

  if (Array.isArray(params.index)) {
    return params.index.join(',');
  }
}

export function startSpan({ tracer, attributes }: StartSpanPayload): Span {
  return tracer.startSpan('elasticsearch.request', {
    kind: SpanKind.CLIENT,
    attributes: {
      [SEMATTRS_DB_SYSTEM]: 'elasticsearch',
      ...attributes,
    },
  });
}

export function normalizeArguments(
  params: unknown,
  options: unknown,
  callback: unknown
): [object, object, Function] {
  // Copied normalizeArguments function from @elastic/elasticsearch
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (typeof params === 'function' || params === undefined || params === null) {
    callback = params;
    params = {};
    options = {};
  }
  return [params as object, options as object, callback as Function];
}

export function getPort(port: string, protocol: string): string {
  if (port) return port;

  if (protocol === 'https:') return '443';
  if (protocol === 'http:') return '80';

  return '';
}

export function getNetAttributes(url: string): Attributes {
  const { port, protocol, hostname } = new URL(url);

  return {
    [SEMATTRS_NET_TRANSPORT]: 'IP.TCP',
    [SEMATTRS_NET_PEER_NAME]: hostname,
    [SEMATTRS_NET_PEER_PORT]: getPort(port, protocol),
  };
}

export function onResponse(
  span: Span,
  result: { meta: { connection: { url: URL } } },
  responseHook?: ResponseHook
) {
  span.setAttributes({
    ...getNetAttributes(result.meta.connection.url.toString()),
  });

  span.setStatus({
    code: SpanStatusCode.OK,
  });

  if (responseHook) {
    safeExecuteInTheMiddle(
      () => responseHook(span, result),
      e => {
        if (e) {
          diag.error('elasticsearch instrumentation: responseHook error', e);
        }
      },
      true
    );
  }

  span.end();
}

export function onError(span: Span, err: Error) {
  span.recordException(err);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: err.message,
  });

  span.end();
}

export const defaultDbStatementSerializer: DbStatementSerializer = (
  operation,
  params,
  options
) => JSON.stringify({ params, options });
