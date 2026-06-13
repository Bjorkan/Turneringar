from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from dataclasses import dataclass


@dataclass
class LiveEvent:
    kind: str
    payload: dict

    def to_sse(self) -> str:
        return f"event: {self.kind}\ndata: {json.dumps(self.payload, ensure_ascii=False)}\n\n"


class RealtimeHub:
    def __init__(self) -> None:
        self._queues: dict[int, set[asyncio.Queue[LiveEvent]]] = defaultdict(set)

    async def subscribe(self, tournament_id: int):
        queue: asyncio.Queue[LiveEvent] = asyncio.Queue(maxsize=20)
        self._queues[tournament_id].add(queue)
        try:
            yield queue
        finally:
            self._queues[tournament_id].discard(queue)

    def publish(self, tournament_id: int, kind: str, payload: dict) -> None:
        event = LiveEvent(kind=kind, payload=payload)
        for queue in list(self._queues.get(tournament_id, set())):
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            queue.put_nowait(event)


hub = RealtimeHub()

