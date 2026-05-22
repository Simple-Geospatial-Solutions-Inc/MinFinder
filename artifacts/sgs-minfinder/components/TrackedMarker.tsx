import React, { useEffect, useState } from "react";
import { Marker, MarkerProps } from "react-native-maps";

/**
 * react-native-maps captures a custom marker's view to a bitmap. If
 * tracksViewChanges starts false, the first capture often happens before
 * the React Native subview has laid out — producing an invisible pin.
 *
 * This wrapper turns on tracking for the first ~250 ms after mount so the
 * pin is captured correctly, then disables it to keep the marker static
 * during pan/zoom.
 */
export function TrackedMarker(props: MarkerProps & { children: React.ReactNode }) {
  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTracks(false), 250);
    return () => clearTimeout(t);
  }, []);
  return <Marker {...props} tracksViewChanges={tracks} />;
}
