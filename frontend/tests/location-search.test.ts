import { expect, it } from "vitest";
import { ROOMS, HOMESTAYS } from "../src/lib/data";
import { matchesLocation } from "../src/lib/location-search";

it("filters fixture locations with Vietnamese accents, abbreviations and empty queries", () => {
  const roomsAt = (query: string) => ROOMS.filter((room) => matchesLocation(query, room.address, ...room.nearby.map((place) => place.name)));
  const staysAt = (query: string) => HOMESTAYS.filter((stay) => matchesLocation(query, stay.city, stay.location));
  expect(roomsAt("quan 5").map((room) => room.id)).toEqual(["6"]);
  expect(roomsAt("ĐH Bách Khoa").map((room) => room.id)).toEqual(["1", "2", "3"]);
  expect(roomsAt("Da Lat")).toHaveLength(0);
  expect(roomsAt("  ")).toHaveLength(ROOMS.length);
  expect(staysAt("Bến Thành").map((stay) => stay.id)).toEqual(["h1"]);
  expect(staysAt("TP.HCM")).toHaveLength(HOMESTAYS.length);
  expect(staysAt("TP. Hồ Chí Minh")).toHaveLength(HOMESTAYS.length);
  expect(staysAt("Đà Lạt")).toHaveLength(0);
});
