import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useColors } from "@/hooks/useColors";

interface CodeBlockProps {
  language: string;
  code: string;
}

const keywords = new Set([
  "as", "async", "await", "break", "case", "catch", "class", "const", "continue",
  "def", "default", "elif", "else", "export", "extends", "false", "finally", "for",
  "from", "function", "if", "import", "in", "interface", "let", "new", "null",
  "of", "pass", "print", "raise", "return", "self", "static", "super", "switch",
  "this", "throw", "true", "try", "type", "undefined", "var", "while", "with",
  "yield", "None", "True", "False",
]);

interface Token {
  text: string;
  color: string;
}

function highlightCode(code: string, colors: ReturnType<typeof useColors>): Token[] {
  const pattern =
    /(#.*$|\/\/.*$|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<\/?[A-Za-z][^>]*>|\\[A-Za-z]+|\b[A-Za-z_$][\w$]*\b|\b\d+(?:\.\d+)?\b)/gm;
  const tokens: Token[] = [];
  let cursor = 0;

  for (const match of code.matchAll(pattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > cursor) tokens.push({ text: code.slice(cursor, index), color: colors.foreground });

    let color = colors.foreground;
    if (/^(#|\/\/|\/\*|<!--)/.test(token)) color = colors.syntaxComment;
    else if (/^["']/.test(token)) color = colors.syntaxString;
    else if (/^<\/?[A-Za-z]/.test(token)) color = colors.syntaxTag;
    else if (token.startsWith("\\")) color = colors.syntaxMath;
    else if (/^\d/.test(token)) color = colors.syntaxNumber;
    else if (keywords.has(token)) color = colors.syntaxKeyword;

    tokens.push({ text: token, color });
    cursor = index + token.length;
  }

  if (cursor < code.length) tokens.push({ text: code.slice(cursor), color: colors.foreground });
  return tokens;
}

export function CodeBlock({ language, code }: CodeBlockProps) {
  const colors = useColors();
  const [copied, setCopied] = useState(false);
  const tokens = highlightCode(code, colors);

  async function copyCode() {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_600);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.codeSurface, borderColor: colors.border }]}>
      <View style={[styles.header, { backgroundColor: colors.codeHeader, borderBottomColor: colors.border }]}>
        <Text style={[styles.language, { color: colors.mutedForeground }]}>
          {language || "CODE"}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copied ? "Code copied" : "Copy code"}
          onPress={copyCode}
          style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
          testID="copy-code"
        >
          <Feather name={copied ? "check" : "copy"} size={14} color={copied ? colors.success : colors.mutedForeground} />
          <Text style={[styles.copyLabel, { color: copied ? colors.success : colors.mutedForeground }]}>
            {copied ? "Copied" : "Copy"}
          </Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text selectable style={[styles.code, { color: colors.foreground }]}>
          {tokens.map((token, index) => (
            <Text key={`${index}-${token.text}`} style={{ color: token.color }}>
              {token.text}
            </Text>
          ))}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 15,
    overflow: "hidden",
    marginTop: 10,
    marginBottom: 3,
  },
  header: {
    minHeight: 37,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  language: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  copyButton: {
    minHeight: 34,
    paddingHorizontal: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  copyLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  code: {
    minWidth: 280,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 12,
    lineHeight: 19,
    fontFamily: "monospace",
  },
  pressed: {
    opacity: 0.65,
  },
});
