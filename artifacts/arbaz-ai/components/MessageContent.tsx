import { Fragment } from "react";
import { Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { CodeBlock } from "@/components/CodeBlock";

interface MessageContentProps {
  content: string;
}

type ContentPart = { kind: "text"; value: string } | { kind: "code"; language: string; value: string };

function splitContent(content: string): ContentPart[] {
  const parts: ContentPart[] = [];
  const pattern = /```([a-zA-Z0-9_+#.-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  let cursor = 0;

  for (const match of content.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ kind: "text", value: content.slice(cursor, index) });
    parts.push({ kind: "code", language: match[1] ?? "", value: (match[2] ?? "").replace(/\n$/, "") });
    cursor = index + match[0].length;
  }

  if (cursor < content.length) parts.push({ kind: "text", value: content.slice(cursor) });
  return parts;
}

function renderInline(text: string, color: string, accent: string) {
  const chunks = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return chunks.map((chunk, index) => {
    if (chunk.startsWith("`") && chunk.endsWith("`")) {
      return (
        <Text key={index} style={{ color: accent, fontFamily: "monospace", fontSize: 13 }}>
          {chunk.slice(1, -1)}
        </Text>
      );
    }
    if (chunk.startsWith("**") && chunk.endsWith("**")) {
      return (
        <Text key={index} style={{ color, fontFamily: "Inter_600SemiBold" }}>
          {chunk.slice(2, -2)}
        </Text>
      );
    }
    if (chunk.startsWith("*") && chunk.endsWith("*")) {
      return <Text key={index} style={{ color, fontStyle: "italic" }}>{chunk.slice(1, -1)}</Text>;
    }
    return <Text key={index} style={{ color }}>{chunk}</Text>;
  });
}

export function MessageContent({ content }: MessageContentProps) {
  const colors = useColors();
  const parts = splitContent(content);

  return (
    <View>
      {parts.map((part, index) =>
        part.kind === "code" ? (
          <CodeBlock key={`code-${index}`} language={part.language} code={part.value} />
        ) : (
          <Fragment key={`text-${index}`}>
            {part.value.split("\n").map((line, lineIndex) => {
              const trimmed = line.trimStart();
              const bullet = trimmed.startsWith("- ") || trimmed.startsWith("* ");
              const ordered = /^\d+\.\s/.test(trimmed);
              const heading = /^#{1,3}\s/.test(trimmed);
              const displayText = heading ? trimmed.replace(/^#{1,3}\s/, "") : bullet ? trimmed.slice(2) : ordered ? trimmed.replace(/^\d+\.\s/, "") : line;

              if (!displayText.trim()) return <View key={`space-${lineIndex}`} style={{ height: 7 }} />;
              return (
                <Text
                  key={`line-${lineIndex}`}
                  style={{
                    color: colors.foreground,
                    fontSize: heading ? 15 : 14,
                    lineHeight: heading ? 22 : 22,
                    fontFamily: heading ? "Inter_600SemiBold" : "Inter_400Regular",
                    marginBottom: 2,
                  }}
                >
                  {bullet ? "• " : ordered ? `${trimmed.match(/^\d+/)?.[0]}. ` : ""}
                  {renderInline(displayText, colors.foreground, colors.primary)}
                </Text>
              );
            })}
          </Fragment>
        ),
      )}
    </View>
  );
}
