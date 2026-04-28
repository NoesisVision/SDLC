import { isValidElement, useEffect, useId, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import mermaid from "mermaid";
import classes from "./markdown-content.module.css";

type MarkdownVariant = "sm" | "md";

interface MarkdownContentProps {
  text: string;
  variant?: MarkdownVariant;
  italic?: boolean;
}

let mermaidInitialized = false;

function ensureMermaidInitialized(): void {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "strict",
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  });
  mermaidInitialized = true;
}

function variantClass(variant: MarkdownVariant): string {
  switch (variant) {
    case "sm":
      return classes.sm;
    case "md":
      return classes.md;
  }
}

const markdownComponents: Components = {
  pre({ children }) {
    if (isValidElement(children)) {
      const codeProps = children.props as {
        className?: string;
        children?: ReactNode;
      };
      const language = /language-(\w+)/.exec(codeProps.className ?? "")?.[1];
      if (language === "mermaid") {
        return <Mermaid chart={String(codeProps.children ?? "").trim()} />;
      }
    }
    return <pre>{children}</pre>;
  },
};

export function MarkdownContent({
  text,
  variant = "md",
  italic = false,
}: MarkdownContentProps) {
  const wrapperClass = [
    classes.root,
    variantClass(variant),
    italic ? classes.italic : "",
  ]
    .filter((c) => c !== "")
    .join(" ");
  return (
    <div className={wrapperClass}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function Mermaid({ chart }: { chart: string }) {
  const reactId = useId();
  const renderId = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureMermaidInitialized();
    mermaid
      .render(renderId, chart)
      .then(({ svg }) => {
        if (!cancelled) {
          setSvg(svg);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSvg(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [chart, renderId]);

  if (error !== null) {
    return (
      <div className={classes.mermaidError}>
        <div className={classes.mermaidErrorLabel}>Mermaid render error</div>
        <pre>{chart}</pre>
      </div>
    );
  }
  if (svg === null) {
    return <div className={classes.mermaidLoading}>Rendering diagram…</div>;
  }
  return (
    <div
      className={classes.mermaid}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
