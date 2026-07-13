import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent } from "./intent.js";
import { MARKET_ES } from "../config.js";

test("classifyIntent: 'reservar' → transactional", () => {
  assert.equal(classifyIntent("reservar restaurante madrid", MARKET_ES).intent, "transactional");
});

test("classifyIntent: 'mejor' → commercial", () => {
  assert.equal(classifyIntent("mejor pizzeria napolitana", MARKET_ES).intent, "commercial");
});

test("classifyIntent: 'cómo' → informational", () => {
  assert.equal(classifyIntent("cómo hacer pasta fresca", MARKET_ES).intent, "informational");
});

test("classifyIntent: detecta señal local por ciudad", () => {
  assert.equal(classifyIntent("trattoria madrid centro", MARKET_ES).is_local, true);
});
