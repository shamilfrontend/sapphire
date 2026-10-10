/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useId, useRef, useState } from 'react';
import { createTrustedTypesPolicy } from '../../../../../../../base/browser/trustedTypes.js';
import { BlockCode } from '../util/inputs.js';

type TtPolicy = NonNullable<ReturnType<typeof createTrustedTypesPolicy>>;

let mermaidTtPolicy: TtPolicy | undefined;
let mermaidTtTried = false;

function ensureMermaidTrustedTypes(): TtPolicy | undefined {
  if (!mermaidTtTried) {
    mermaidTtTried = true;
    mermaidTtPolicy = createTrustedTypesPolicy('default', {
      createHTML: (value: string) => value,
    }) as TtPolicy | undefined;
  }
  return mermaidTtPolicy;
}

function setSvgHtml(container: HTMLElement, svg: string): void {
  const policy = ensureMermaidTrustedTypes();
  if (policy?.createHTML) {
    container.innerHTML = policy.createHTML(svg) as unknown as string;
    return;
  }
  // без Trusted Types — парсим SVG через DOMParser
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = parsed.documentElement;
  container.replaceChildren();
  if (root && root.nodeName.toLowerCase() !== 'parsererror') {
    container.appendChild(document.importNode(root, true));
  }
}

export const MermaidBlock = ({ code }: { code: string }) => {
  const reactId = useId().replace(/:/g, '');
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        ensureMermaidTrustedTypes();
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'dark',
          fontFamily: 'var(--vscode-font-family)',
        });
        const id = `mermaid-${reactId}`;
        const { svg } = await mermaid.render(id, code);
        if (cancelled || !containerRef.current) return;
        setSvgHtml(containerRef.current, svg);
        setFailed(false);
      } catch (err) {
        console.error('[MermaidBlock] render failed', err);
        if (!cancelled) setFailed(true);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [code, reactId]);

  if (failed) {
    return (
      <div className="my-2 rounded border border-void-border-2 overflow-hidden">
        <div className="px-2 py-1 text-[11px] text-void-fg-3 bg-void-bg-2">Mermaid (исходник)</div>
        <BlockCode initValue={code.trimEnd()} language="mermaid" />
      </div>
    );
  }

  return (
    <div className="my-2 rounded border border-void-border-2 bg-void-bg-2 overflow-auto p-2">
      <div ref={containerRef} className="flex justify-center [&_svg]:max-w-full" />
    </div>
  );
};
