import { expect, test } from "vitest";
import {
	livenessRouteIds,
	selfAuthenticatedRoutes,
	skipsSessionGuard,
} from "../src/lib/server/public-routes.ts";

const webhook = selfAuthenticatedRoutes[0].routeId;

test("the session guard skip is method-specific", () => {
	expect(skipsSessionGuard("POST", webhook)).toBe(true);
	expect(skipsSessionGuard("GET", webhook)).toBe(false);
	expect(skipsSessionGuard("PUT", webhook)).toBe(false);
	for (const routeId of livenessRouteIds) {
		expect(skipsSessionGuard("GET", routeId)).toBe(true);
		expect(skipsSessionGuard("HEAD", routeId)).toBe(true);
		expect(skipsSessionGuard("PUT", routeId)).toBe(false);
	}
	expect(skipsSessionGuard("GET", null)).toBe(false);
});
