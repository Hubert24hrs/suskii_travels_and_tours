require('react-native-gesture-handler/jestSetup');

// Reanimated's mock does not implement useReducedMotion yet ("ADD ME IF NEEDED" upstream).
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  useReducedMotion: () => false,
}));
jest.mock('@gorhom/bottom-sheet', () => require('@gorhom/bottom-sheet/mock'));

// Expo Router pulls native views (glass effect, native tabs) at import time. Screens only use the
// hooks below; tests assert navigation through the exported `router` mock.
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  const router = {
    push: jest.fn(),
    replace: jest.fn(),
    navigate: jest.fn(),
    back: jest.fn(),
    dismiss: jest.fn(),
    dismissAll: jest.fn(),
    setParams: jest.fn(),
    canGoBack: jest.fn(() => true),
  };
  const Screen = () => null;
  const Navigator = ({ children }) => children ?? null;
  return {
    router,
    useRouter: () => router,
    useLocalSearchParams: jest.fn(() => ({})),
    useFocusEffect: (effect) => useEffect(() => effect(), [effect]),
    Stack: Object.assign(Navigator, { Screen }),
    Tabs: Object.assign(Navigator, { Screen }),
  };
});

// Keychain / Keystore: an in-memory store per test file.
jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    getItemAsync: jest.fn((key) => Promise.resolve(store.get(key) ?? null)),
    setItemAsync: jest.fn((key, value) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
});

jest.mock('expo-crypto', () => {
  const crypto = require('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    randomUUID: () => crypto.randomUUID(),
    getRandomBytes: (size) => new Uint8Array(crypto.randomBytes(size)),
    digestStringAsync: (_algorithm, value) =>
      Promise.resolve(crypto.createHash('sha256').update(value).digest('hex')),
  };
});

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-NG', languageCode: 'en', regionCode: 'NG' }],
}));

// MMKV 4 loads Nitro's native module on import; its own in-memory mock is used instead.
jest.mock('react-native-mmkv', () => {
  const { createMockMMKV } = require('react-native-mmkv/lib/createMMKV/createMockMMKV');
  return { createMMKV: (config) => createMockMMKV(config) };
});

// No native constants module in Jest: the app config the screens read, as in a development build.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '0.1.0', extra: { variant: 'development' } } },
}));

// FLAG_SECURE and the iOS app-switcher blur are native-only.
jest.mock('expo-screen-capture', () => ({
  usePreventScreenCapture: jest.fn(),
  enableAppSwitcherProtectionAsync: jest.fn(() => Promise.resolve()),
  disableAppSwitcherProtectionAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(() => Promise.resolve({ type: 'dismiss' })),
  openBrowserAsync: jest.fn(() => Promise.resolve({ type: 'dismiss' })),
}));
// The system document picker: cancelled unless a test says otherwise.
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(() => Promise.resolve({ canceled: true, assets: null })),
}));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(() => Promise.resolve()) }));

// App-private files: an in-memory file system with the same `File` / `Directory` surface.
jest.mock('expo-file-system', () => {
  const files = new Set();
  const join = (parts) =>
    parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
  class Directory {
    constructor(...parts) {
      this.uri = join(parts);
    }
    get exists() {
      return [...files].some((uri) => uri.startsWith(`${this.uri}/`));
    }
    create() {
      // Directories exist implicitly in the in-memory file system.
    }
    delete() {
      for (const uri of [...files]) if (uri.startsWith(`${this.uri}/`)) files.delete(uri);
    }
  }
  const contents = new Map();
  class File {
    constructor(...parts) {
      this.uri = join(parts);
    }
    get exists() {
      return files.has(this.uri);
    }
    bytes() {
      return Promise.resolve(contents.get(this.uri) ?? new Uint8Array());
    }
    text() {
      return Promise.resolve(new TextDecoder().decode(contents.get(this.uri) ?? new Uint8Array()));
    }
    create() {
      files.add(this.uri);
    }
    write(content) {
      files.add(this.uri);
      contents.set(
        this.uri,
        typeof content === 'string' ? new TextEncoder().encode(content) : content,
      );
    }
    delete() {
      files.delete(this.uri);
      contents.delete(this.uri);
    }
  }
  /** Test helper: puts a file with these bytes in the in-memory file system. */
  File.__write = (uri, bytes) => {
    files.add(uri);
    contents.set(uri, bytes);
  };
  File.downloadFileAsync = jest.fn((_url, destination) => {
    files.add(destination.uri);
    return Promise.resolve(destination);
  });
  return {
    File,
    Directory,
    Paths: { document: { uri: 'file:///data/documents' }, cache: { uri: 'file:///data/cache' } },
  };
});
