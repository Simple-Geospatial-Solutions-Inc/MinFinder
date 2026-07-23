// Local entry point. Using a real file in the app tree (instead of the
// "expo-router/entry" package specifier as `main`) so Metro doesn't resolve a
// workspace-relative package path as the bundle entry — on Windows that fails
// with "Unable to resolve module expo-router/entry". The inner import resolves
// via normal in-graph module resolution.
import "expo-router/entry";
