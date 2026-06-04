"use client";

import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

// Initialize mermaid
mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  securityLevel: "loose",
  themeVariables: {
    background: "#0a0a0f",
    primaryColor: "#7c5cfc",
    primaryTextColor: "#e8e8f0",
    lineColor: "#7c5cfc",
  }
});

interface MermaidProps {
  chart: string;
}

export default function Mermaid({ chart }: MermaidProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const id = `mermaid-${Math.random().toString(36).substring(2, 9)}`;

    const renderChart = async () => {
      try {
        setError(null);
        // Clear container and process the chart
        const cleanChart = chart.trim();
        if (!cleanChart) return;

        const { svg: renderedSvg } = await mermaid.render(id, cleanChart);
        if (isMounted) {
          setSvg(renderedSvg);
        }
      } catch (err) {
        // If it's a parse error (common when streaming) we just show the code block for now
        if (isMounted) {
          setError("Rendering diagram...");
        }
      }
    };

    renderChart();

    return () => {
      isMounted = false;
    };
  }, [chart]);

  if (error) {
    return (
      <div className="mermaid-container text-xs text-muted p-4 bg-black/20 rounded">
        <pre className="text-left overflow-x-auto"><code>{chart}</code></pre>
        <div className="mt-2 text-yellow-500">{error}</div>
      </div>
    );
  }

  if (!svg) {
    return <div className="loading-indicator">Generating diagram...</div>;
  }

  return (
    <div 
      ref={containerRef} 
      className="mermaid-container flex justify-center items-center overflow-x-auto p-4 bg-black/10 rounded-lg"
      dangerouslySetInnerHTML={{ __html: svg }} 
    />
  );
}
