import { EventBus } from "./index";

type TestEvents = {
  created: { id: string; value: number };
  deleted: { id: string };
};

const bus = new EventBus<TestEvents>();

let createdEvent: TestEvents["created"] | null = null;
let deletedCount = 0;

const createdHandler = (event: TestEvents["created"]) => {
  createdEvent = event;
};

const deletedHandler = (_event: TestEvents["deleted"]) => {
  deletedCount += 1;
};

bus.on("created", createdHandler);
bus.on("deleted", deletedHandler);

bus.emit("created", { id: "item-1", value: 42 });
bus.emit("deleted", { id: "item-1" });

if (!createdEvent) {
  throw new Error("Expected created event to be received");
}

const firstCreatedEvent: TestEvents["created"] = createdEvent;

if (
  firstCreatedEvent.id !== "item-1" ||
  firstCreatedEvent.value !== 42
) {
  throw new Error("Created event payload was incorrect");
}

if (deletedCount !== 1) {
  throw new Error("Expected deleted handler to run once");
}

bus.off("deleted", deletedHandler);
bus.emit("deleted", { id: "item-2" });

if (deletedCount !== 1) {
  throw new Error("Expected deleted handler to be removed");
}

bus.off("created", createdHandler);
bus.emit("created", { id: "item-2", value: 100 });

if (
  firstCreatedEvent.id !== "item-1" ||
  firstCreatedEvent.value !== 42
) {
  throw new Error("Expected created handler to be removed");
}

console.log("EventBus tests passed");