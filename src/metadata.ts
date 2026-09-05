import {
  Bytes,
  dataSource,
  json,
  JSONValue,
  JSONValueKind,
  TypedMap,
} from "@graphprotocol/graph-ts";
import { Metadata } from "../generated/schema";

function stringField(object: TypedMap<string, JSONValue>, key: string): string | null {
  const value = object.get(key);
  return value != null && value.kind == JSONValueKind.STRING
    ? value.toString()
    : null;
}

/** File-source handler: it only creates the immutable Metadata entity. */
export function handleMetadata(content: Bytes): void {
  const identifier = dataSource.stringParam();
  if (identifier.length == 0) return;

  const parsed = json.try_fromBytes(content);
  if (!parsed.isOk || parsed.value.kind != JSONValueKind.OBJECT) return;

  const object = parsed.value.toObject();
  const metadata = new Metadata(identifier);
  metadata.name = stringField(object, "name");
  metadata.bio = stringField(object, "bio");
  metadata.imageUrl = stringField(object, "imageUrl");
  metadata.description = stringField(object, "description");
  metadata.save();
}
