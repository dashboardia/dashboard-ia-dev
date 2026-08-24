"use client";

import { useEffect, useState } from "react";

import { formatExecutionDuration } from "../../../lib/execution-duration";

export default function ExecutionDuration({ startedAt, finishedAt, initialNow }) {
  const [now, setNow] = useState(initialNow);

  useEffect(() => {
    if (!startedAt || finishedAt) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [finishedAt, startedAt]);

  return formatExecutionDuration(startedAt, finishedAt, now);
}
