"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Mermaid from "./Mermaid";

interface SafeMarkdownProps {
  content: string;
}

export default function SafeMarkdown({ content }: SafeMarkdownProps) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const isMermaid = match && match[1] === "mermaid";

            if (isMermaid) {
              return <Mermaid chart={String(children).replace(/\n$/, "")} />;
            }

            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          table: ({ children }) => (
            <div className="table-container my-4 overflow-x-auto border border-subtle rounded-lg">
              <table className="min-w-full divide-y divide-subtle text-left text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-elevated font-semibold text-primary">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="px-4 py-3 border-b border-subtle">{children}</th>
          ),
          td: ({ children }) => (
            <td className="px-4 py-3 border-b border-subtle text-secondary">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
