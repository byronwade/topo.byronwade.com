import "../app/globals.css";

import { StatusCard } from "./StatusCard";

export function Routes() {
  return <StatusCard label="Routes" value="5" detail="App Router screens" />;
}

export function States() {
  return (
    <StatusCard label="States" value="3" detail="default, loading, not-found" />
  );
}
