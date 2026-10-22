import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import { useColors } from "@/hooks/useColors";
import { MessageContent } from "@/components/MessageContent";
import { createMessageId, getLocalAssistantReply, streamGeminiChat, type ChatMessage } from "@/lib/chat";

const STORAGE_KEY = "arbaz-ai-chat-v1";
const MAX_STORED_MESSAGES = 80;
const voiceLocales = ["en-IN", "hi-IN"] as const;
type VoiceLocale = (typeof voiceLocales)[number];

interface RecognitionAlternative {
  transcript: string;
}

interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<RecognitionAlternative>>;
}

interface BrowserRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface BrowserSpeechUtterance {
  lang: string;
  voice?: { lang: string } | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

interface BrowserVoice {
  lang: string;
}

interface BrowserSpeechGlobals {
  SpeechRecognition?: new () => BrowserRecognition;
  webkitSpeechRecognition?: new () => BrowserRecognition;
  SpeechSynthesisUtterance?: new (text: string) => BrowserSpeechUtterance;
  speechSynthesis?: {
    speak(utterance: BrowserSpeechUtterance): void;
    cancel(): void;
    getVoices(): BrowserVoice[];
  };
  confirm?: (message: string) => boolean;
}

const browserSpeech = globalThis as unknown as BrowserSpeechGlobals;

function detectSpeechLocale(content: string): string {
  if (/[\u0900-\u097F]/.test(content)) return "hi-IN";
  if (/\b(kya|kaise|hai|hain|mein|mujhe|batao|karo|aur)\b/i.test(content)) return "en-IN";
  return "en-US";
}

function textForSpeech(content: string): string {
  return content.replace(/```[\s\S]*?```/g, "Code block omitted.").replace(/[`*_#]/g, "").trim();
}

function AssistantMark({ small = false }: { small?: boolean }) {
  const colors = useColors();
  return (
    <LinearGradient
      colors={[colors.primary, colors.accent]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.mark, small && styles.smallMark]}
    >
      <Feather name="cpu" size={small ? 14 : 18} color={colors.primaryForeground} />
    </LinearGradient>
  );
}

function TypingIndicator() {
  const colors = useColors();
  return (
    <View style={styles.typingRow}>
      <AssistantMark small />
      <View style={[styles.typingBubble, { backgroundColor: colors.surfaceGlass, borderColor: colors.border }]}>
        <Text style={[styles.typingText, { color: colors.mutedForeground }]}>Arbaz AI is thinking</Text>
        <View style={styles.typingDots}>
          {[0, 1, 2].map((dot) => (
            <View key={dot} style={[styles.typingDot, { backgroundColor: colors.primary, opacity: 1 - dot * 0.2 }]} />
          ))}
        </View>
      </View>
    </View>
  );
}

function MessageRow({
  message,
  speaking,
  onSpeak,
}: {
  message: ChatMessage;
  speaking: boolean;
  onSpeak: (message: ChatMessage) => void;
}) {
  const colors = useColors();
  const isUser = message.role === "user";

  return (
    <View style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}>
      {!isUser && <AssistantMark small />}
      <View
        style={[
          styles.messageBubble,
          isUser
            ? [styles.userBubble, { backgroundColor: colors.userBubble, borderColor: colors.border }]
            : [styles.assistantBubble, { backgroundColor: colors.surfaceGlass, borderColor: colors.border }],
        ]}
      >
        {!isUser && (
          <View style={styles.messageLabelRow}>
            <Text style={[styles.messageLabel, { color: colors.primary }]}>ARBAZ AI</Text>
            <View style={[styles.messageLabelDot, { backgroundColor: colors.success }]} />
            <Text style={[styles.messageLabelMeta, { color: colors.mutedForeground }]}>RESPONSE</Text>
          </View>
        )}
        <MessageContent content={message.content} />
        {!isUser && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={speaking ? "Stop speaking" : "Speak this response"}
            onPress={() => onSpeak(message)}
            style={({ pressed }) => [styles.speakButton, pressed && styles.pressed]}
            testID={`speak-${message.id}`}
          >
            <Feather name={speaking ? "volume-x" : "volume-2"} size={15} color={speaking ? colors.primary : colors.mutedForeground} />
            <Text style={[styles.speakLabel, { color: speaking ? colors.primary : colors.mutedForeground }]}>
              {speaking ? "Stop" : "Listen"}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function WelcomeState({ onPrompt }: { onPrompt: (prompt: string) => void }) {
  const colors = useColors();
  const prompts = [
    { icon: "code" as const, text: "Write a Python script" },
    { icon: "activity" as const, text: "Help me solve a math problem" },
    { icon: "globe" as const, text: "Explain a science topic" },
  ];

  return (
    <View style={styles.welcome}>
      <LinearGradient
        colors={[colors.surfaceGlass, colors.card]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.welcomeCard, { borderColor: colors.border }]}
      >
        <View style={[styles.orbit, { borderColor: colors.border, backgroundColor: colors.background }]}>
          <AssistantMark />
        </View>
        <Text style={[styles.welcomeEyebrow, { color: colors.primary }]}>YOUR THOUGHT PARTNER</Text>
        <Text style={[styles.welcomeTitle, { color: colors.foreground }]}>Let’s figure it out.</Text>
        <Text style={[styles.welcomeCopy, { color: colors.mutedForeground }]}>
          Ask anything in English, Hindi, or Hinglish. Build, learn, solve, or just explore.
        </Text>
      </LinearGradient>
      <Text style={[styles.suggestionHeading, { color: colors.mutedForeground }]}>A few places to start</Text>
      <View style={styles.suggestionList}>
        {prompts.map((prompt) => (
          <Pressable
            key={prompt.text}
            accessibilityRole="button"
            onPress={() => onPrompt(prompt.text)}
            style={({ pressed }) => [
              styles.suggestion,
              { backgroundColor: colors.surfaceGlass, borderColor: colors.border },
              pressed && styles.pressed,
            ]}
            testID={`prompt-${prompt.icon}`}
          >
            <Feather name={prompt.icon} size={16} color={colors.primary} />
            <Text style={[styles.suggestionText, { color: colors.foreground }]}>{prompt.text}</Text>
            <Feather name="arrow-up-right" size={14} color={colors.mutedForeground} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [showTyping, setShowTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceLocaleIndex, setVoiceLocaleIndex] = useState(0);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const recognitionRef = useRef<BrowserRecognition | null>(null);
  const activeRequestRef = useRef(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!active || !stored) return;
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const restored = parsed
            .filter(
              (item): item is ChatMessage =>
                !!item &&
                typeof item === "object" &&
                typeof item.id === "string" &&
                (item.role === "user" || item.role === "assistant") &&
                typeof item.content === "string",
            )
            .slice(-MAX_STORED_MESSAGES);
          setMessages(restored);
        }
      })
      .catch(() => {
        if (active) setMessages([]);
      })
      .finally(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || isStreaming) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES))).catch(() => {
      setNotice("This conversation couldn’t be saved on this device.");
    });
  }, [messages, hydrated, isStreaming]);

  useEffect(
    () => () => {
      recognitionRef.current?.stop();
      if (Platform.OS === "web") browserSpeech.speechSynthesis?.cancel();
      else Speech.stop();
    },
    [],
  );

  const haptic = useCallback(() => {
    if (Platform.OS !== "web") void Haptics.selectionAsync();
  }, []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(""), 3_500);
  }, []);

  const handleSpeak = useCallback(
    (message: ChatMessage) => {
      haptic();
      if (speakingId === message.id) {
        if (Platform.OS === "web") browserSpeech.speechSynthesis?.cancel();
        else void Speech.stop();
        setSpeakingId(null);
        return;
      }

      if (Platform.OS === "web") browserSpeech.speechSynthesis?.cancel();
      else void Speech.stop();

      const spokenText = textForSpeech(message.content);
      const language = detectSpeechLocale(spokenText);
      setSpeakingId(message.id);

      const finish = () => setSpeakingId((current) => (current === message.id ? null : current));
      if (Platform.OS === "web") {
        const SpeechUtterance = browserSpeech.SpeechSynthesisUtterance;
        const synthesis = browserSpeech.speechSynthesis;
        if (!SpeechUtterance || !synthesis) {
          finish();
          showNotice("Speech playback isn’t supported in this browser.");
          return;
        }
        const utterance = new SpeechUtterance(spokenText);
        utterance.lang = language;
        utterance.voice = synthesis.getVoices().find((voice) => voice.lang.toLowerCase().startsWith(language.slice(0, 2))) ?? null;
        utterance.onend = finish;
        utterance.onerror = finish;
        synthesis.speak(utterance);
      } else {
        Speech.speak(spokenText, {
          language,
          onDone: finish,
          onStopped: finish,
          onError: finish,
        });
      }
    },
    [haptic, showNotice, speakingId],
  );

  const handleSend = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? draft).trim();
      if (!text || activeRequestRef.current) return;

      activeRequestRef.current = true;
      haptic();
      const history = messages.map(({ role, content }) => ({ role, content }));
      const userMessage: ChatMessage = { id: createMessageId(), role: "user", content: text };
      setMessages((current) => [...current, userMessage].slice(-MAX_STORED_MESSAGES));
      setDraft("");

      const localReply = getLocalAssistantReply(text);
      if (localReply) {
        setMessages((current) => [
          ...current,
          { id: createMessageId(), role: "assistant", content: localReply },
        ]);
        activeRequestRef.current = false;
        return;
      }

      setIsStreaming(true);
      setShowTyping(true);
      const assistantId = createMessageId();
      let fullResponse = "";

      try {
        await streamGeminiChat(
          [...history, { role: "user", content: text }],
          (chunk) => {
            fullResponse += chunk;
            setShowTyping(false);
            setMessages((current) => {
              const last = current[current.length - 1];
              if (last?.id === assistantId) {
                return [...current.slice(0, -1), { ...last, content: fullResponse }];
              }
              return [...current, { id: assistantId, role: "assistant", content: fullResponse }];
            });
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Gemini could not answer right now.";
        setShowTyping(false);
        setMessages((current) => [
          ...current,
          {
            id: createMessageId(),
            role: "assistant",
            content: message.includes("GEMINI_API_KEY")
              ? "Gemini isn’t connected yet. Add a fresh GEMINI_API_KEY in Replit Secrets, then try again."
              : message,
          },
        ]);
      } finally {
        activeRequestRef.current = false;
        setIsStreaming(false);
        setShowTyping(false);
      }
    },
    [draft, haptic, messages],
  );

  const startVoiceInput = useCallback(() => {
    haptic();
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    if (Platform.OS !== "web") {
      showNotice("Voice input uses your browser’s Speech Recognition API. Type your message in the native app.");
      return;
    }

    const Recognition = browserSpeech.SpeechRecognition ?? browserSpeech.webkitSpeechRecognition;
    if (!Recognition) {
      showNotice("Voice input isn’t available in this browser. Try a browser that supports Speech Recognition.");
      return;
    }

    const recognition = new Recognition();
    recognition.lang = voiceLocales[voiceLocaleIndex];
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = event.results[event.resultIndex]?.[0]?.transcript?.trim();
      if (transcript) setDraft((current) => (current.trim() ? `${current.trim()} ${transcript}` : transcript));
    };
    recognition.onerror = () => {
      setIsListening(false);
      showNotice("Microphone access failed. Check your browser permissions and try again.");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
    };
    recognitionRef.current = recognition;
    setIsListening(true);

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      showNotice("The microphone couldn’t start. Please try again.");
    }
  }, [haptic, isListening, showNotice, voiceLocaleIndex]);

  const clearChat = useCallback(() => {
    if (isStreaming) return;
    const clear = () => {
      if (Platform.OS === "web") browserSpeech.speechSynthesis?.cancel();
      else void Speech.stop();
      setSpeakingId(null);
      setMessages([]);
    };

    if (Platform.OS === "web" && browserSpeech.confirm) {
      if (browserSpeech.confirm("Clear this conversation from this device?")) clear();
      return;
    }
    Alert.alert("Clear conversation?", "This removes the saved conversation from this device.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: clear },
    ]);
  }, [isStreaming]);

  const renderMessage = useCallback(
    ({ item }: ListRenderItemInfo<ChatMessage>) => (
      <MessageRow message={item} speaking={speakingId === item.id} onSpeak={handleSpeak} />
    ),
    [handleSpeak, speakingId],
  );

  const emptyContent = hydrated ? (
    <WelcomeState onPrompt={(prompt) => void handleSend(prompt)} />
  ) : (
    <View style={styles.loadingState}>
      <AssistantMark />
      <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading your conversation</Text>
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={[colors.background, colors.card, colors.background]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View pointerEvents="none" style={[styles.ambientGlow, { backgroundColor: colors.primary, opacity: 0.075 }]} />
      <KeyboardAvoidingView style={styles.keyboardFrame} behavior="padding" keyboardVerticalOffset={0}>
        <View
          style={[
            styles.header,
            {
              paddingTop: Platform.OS === "web" ? 67 : insets.top + 8,
              borderBottomColor: colors.border,
              backgroundColor: colors.surfaceGlass,
            },
          ]}
        >
          <View style={styles.headerInner}>
            <View style={styles.brand}>
              <AssistantMark />
              <View style={styles.brandText}>
                <Text style={[styles.brandName, { color: colors.foreground }]}>ARBAZ AI</Text>
                <View style={styles.creatorBadge}>
                  <View style={[styles.onlineDot, { backgroundColor: colors.success }]} />
                  <Text numberOfLines={1} style={[styles.creatorText, { color: colors.mutedForeground }]}>
                    Created by Arbaz Khan
                  </Text>
                </View>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear conversation"
              disabled={isStreaming}
              onPress={clearChat}
              style={({ pressed }) => [styles.newChatButton, { borderColor: colors.border }, pressed && styles.pressed, isStreaming && styles.disabled]}
              testID="new-chat"
            >
              <Feather name="plus" size={18} color={colors.foreground} />
            </Pressable>
          </View>
        </View>

        <View style={styles.feedFrame}>
          <FlatList
            ref={listRef}
            data={[...messages].reverse()}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            inverted={messages.length > 0}
            ListEmptyComponent={emptyContent}
            ListHeaderComponent={showTyping ? <TypingIndicator /> : null}
            contentContainerStyle={[
              styles.feedContent,
              { paddingBottom: messages.length === 0 ? 18 : 14, flexGrow: messages.length === 0 ? 1 : undefined },
            ]}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            scrollEnabled={messages.length > 0}
            initialNumToRender={12}
            maxToRenderPerBatch={8}
            windowSize={8}
            testID="chat-messages"
          />
        </View>

        <View
          style={[
            styles.composerShell,
            {
              paddingBottom: Platform.OS === "web" ? 34 : Math.max(insets.bottom, 8),
              borderTopColor: colors.border,
              backgroundColor: colors.surfaceGlass,
            },
          ]}
        >
          <View style={styles.composerInner}>
            {!!notice && (
              <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: colors.mutedForeground }]}>
                {notice}
              </Text>
            )}
            <View style={[styles.composer, { backgroundColor: colors.card, borderColor: colors.input }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Voice language ${voiceLocaleIndex === 0 ? "English India" : "Hindi India"}. Change language`}
                onPress={() => setVoiceLocaleIndex((current) => (current + 1) % voiceLocales.length)}
                style={({ pressed }) => [styles.localeButton, { backgroundColor: colors.secondary }, pressed && styles.pressed]}
                testID="voice-language"
              >
                <Text style={[styles.localeText, { color: colors.primary }]}>{voiceLocaleIndex === 0 ? "EN" : "HI"}</Text>
              </Pressable>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Message Arbaz AI..."
                placeholderTextColor={colors.mutedForeground}
                multiline
                maxLength={12000}
                editable={!isStreaming}
                blurOnSubmit={false}
                returnKeyType="send"
                onSubmitEditing={() => void handleSend()}
                style={[styles.input, { color: colors.foreground }]}
                accessibilityLabel="Message Arbaz AI"
                testID="chat-input"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isListening ? "Stop voice input" : "Start voice input"}
                onPress={startVoiceInput}
                style={({ pressed }) => [
                  styles.iconButton,
                  isListening && { backgroundColor: colors.destructive },
                  pressed && styles.pressed,
                ]}
                testID="voice-input"
              >
                <Feather name={isListening ? "mic-off" : "mic"} size={17} color={isListening ? colors.destructiveForeground : colors.mutedForeground} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                disabled={!draft.trim() || isStreaming}
                onPress={() => void handleSend()}
                style={({ pressed }) => [
                  styles.sendButton,
                  { backgroundColor: draft.trim() && !isStreaming ? colors.primary : colors.secondary },
                  pressed && styles.pressed,
                  (!draft.trim() || isStreaming) && styles.disabled,
                ]}
                testID="send-message"
              >
                <Feather name="arrow-up" size={19} color={draft.trim() && !isStreaming ? colors.primaryForeground : colors.mutedForeground} />
              </Pressable>
            </View>
            <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
              Arbaz AI can make mistakes. Check important information.
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    overflow: "hidden",
  },
  keyboardFrame: {
    flex: 1,
  },
  ambientGlow: {
    position: "absolute",
    top: -130,
    right: -100,
    width: 300,
    height: 300,
    borderRadius: 150,
  },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 10,
  },
  headerInner: {
    width: "100%",
    maxWidth: 980,
    alignSelf: "center",
    paddingHorizontal: 19,
    minHeight: 55,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    flexShrink: 1,
  },
  mark: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  smallMark: {
    width: 28,
    height: 28,
    borderRadius: 10,
  },
  brandText: {
    gap: 2,
  },
  brandName: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    letterSpacing: 1.8,
  },
  creatorBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  onlineDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  creatorText: {
    fontFamily: "Inter_500Medium",
    fontSize: 10,
    letterSpacing: 0.1,
  },
  newChatButton: {
    width: 39,
    height: 39,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  feedFrame: {
    flex: 1,
    width: "100%",
    maxWidth: 980,
    alignSelf: "center",
  },
  feedContent: {
    paddingHorizontal: 18,
    paddingTop: 16,
    gap: 14,
  },
  welcome: {
    width: "100%",
    maxWidth: 590,
    alignSelf: "center",
    flexGrow: 1,
    justifyContent: "center",
    paddingVertical: 14,
    gap: 15,
  },
  welcomeCard: {
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 27,
    paddingHorizontal: 24,
    paddingTop: 25,
    paddingBottom: 26,
    overflow: "hidden",
  },
  orbit: {
    width: 77,
    height: 77,
    borderRadius: 27,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 19,
  },
  welcomeEyebrow: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 9,
    letterSpacing: 2,
    marginBottom: 8,
  },
  welcomeTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 27,
    letterSpacing: -0.8,
    textAlign: "center",
  },
  welcomeCopy: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 20,
    maxWidth: 310,
    textAlign: "center",
    marginTop: 9,
  },
  suggestionHeading: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    letterSpacing: 0.4,
    marginLeft: 4,
    marginTop: 1,
  },
  suggestionList: {
    gap: 8,
  },
  suggestion: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  suggestionText: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
  loadingState: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 13,
  },
  loadingText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
  messageRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
  },
  userRow: {
    justifyContent: "flex-end",
  },
  assistantRow: {
    justifyContent: "flex-start",
  },
  messageBubble: {
    maxWidth: "91%",
    borderWidth: 1,
    borderRadius: 19,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  userBubble: {
    borderTopRightRadius: 7,
  },
  assistantBubble: {
    borderTopLeftRadius: 7,
    flexShrink: 1,
  },
  messageLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  messageLabel: {
    fontFamily: "Inter_700Bold",
    fontSize: 9,
    letterSpacing: 1.15,
  },
  messageLabelDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  messageLabelMeta: {
    fontFamily: "Inter_400Regular",
    fontSize: 9,
  },
  speakButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    minHeight: 34,
    marginTop: 5,
    paddingHorizontal: 2,
  },
  speakLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
  },
  typingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  typingBubble: {
    minHeight: 39,
    borderWidth: 1,
    borderRadius: 15,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  typingText: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
  },
  typingDots: {
    flexDirection: "row",
    gap: 3,
  },
  typingDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  composerShell: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
  composerInner: {
    width: "100%",
    maxWidth: 980,
    alignSelf: "center",
    paddingHorizontal: 15,
  },
  notice: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    paddingHorizontal: 3,
    paddingBottom: 7,
  },
  composer: {
    minHeight: 56,
    borderWidth: 1,
    borderRadius: 19,
    padding: 6,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 5,
  },
  localeButton: {
    height: 34,
    minWidth: 34,
    paddingHorizontal: 5,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  localeText: {
    fontFamily: "Inter_700Bold",
    fontSize: 9,
    letterSpacing: 0.3,
  },
  input: {
    flex: 1,
    minHeight: 41,
    maxHeight: 132,
    paddingHorizontal: 8,
    paddingTop: 10,
    paddingBottom: 8,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 20,
    outlineStyle: "none",
  } as object,
  iconButton: {
    height: 38,
    width: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  sendButton: {
    height: 38,
    width: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  disclaimer: {
    textAlign: "center",
    fontFamily: "Inter_400Regular",
    fontSize: 9,
    marginTop: 8,
  },
  pressed: {
    opacity: 0.73,
  },
  disabled: {
    opacity: 0.65,
  },
});
