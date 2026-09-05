import {
  afterEach,
  assert,
  clearStore,
  dataSourceMock,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { Bytes } from "@graphprotocol/graph-ts";
import { Metadata } from "../../generated/schema";
import { canonicalMetadataIdentifier } from "../../src/utils/metadata";
import { handleMetadata } from "../../src/metadata";

const CID = "bafybeiefas6n4iw4johpoo5mmdpdhkeyjleu7bmc5cbxed7d2dgz74wcqy";

describe("Metadata file source", () => {
  afterEach(() => {
    clearStore();
    dataSourceMock.resetValues();
  });

  test("accepts the observed gateway form and canonicalizes the CID", () => {
    assert.stringEquals(
      canonicalMetadataIdentifier(`https://ipfs.io/ipfs/${CID}/profile.json?cache=1#fragment`)!,
      `${CID}/profile.json`,
    );
    assert.stringEquals(
      canonicalMetadataIdentifier(`ipfs://${CID}/profile.json`)!,
      `${CID}/profile.json`,
    );
    assert.stringEquals(
      canonicalMetadataIdentifier(`https://gateway.example/content/ipfs/${CID}/profile.json`)!,
      `${CID}/profile.json`,
    );
    assert.stringEquals(
      canonicalMetadataIdentifier(`/ipfs/${CID}/profile.json`)!,
      `${CID}/profile.json`,
    );
    assert.stringEquals(
      canonicalMetadataIdentifier(`http://gateway.example/content/ipfs/${CID}`)!,
      CID,
    );
    const bafkCid = "bafkrei" + CID.slice(7);
    assert.stringEquals(
      canonicalMetadataIdentifier(`ipfs://${bafkCid}`)!,
      bafkCid,
    );
  });

  test("rejects unsupported, malformed, traversal, encoded-separator, and invalid-root forms", () => {
    assert.assertNull(canonicalMetadataIdentifier("ipfs://"));
    assert.assertNull(canonicalMetadataIdentifier(`https://gateway.example/content/ipfs/${CID}%2Fsecret`));
    assert.assertNull(canonicalMetadataIdentifier(`https://gateway.example/content/../ipfs/${CID}`));
    assert.assertNull(canonicalMetadataIdentifier(`https://ipfs.io/ipfs/${CID}/../secret`));
    assert.assertNull(canonicalMetadataIdentifier(`https://ipfs.io/ipfs/${CID}//metadata.json`));
    assert.assertNull(canonicalMetadataIdentifier(`https://ipfs.io/ipfs/${CID}%2Fsecret`));
    assert.assertNull(canonicalMetadataIdentifier(`https://ipfs.io/ipfs/${CID.slice(0, 58)}z`));
    assert.assertNull(canonicalMetadataIdentifier("https://ipfs.io/ipfs/Qmlegacy"));
    assert.assertNull(canonicalMetadataIdentifier("https://ipfs.io/ipfs/bafy-not-a-cid"));
  });

  test("creates scalar fields from valid object JSON", () => {
    dataSourceMock.setAddress(CID);
    handleMetadata(Bytes.fromUTF8('{"name":"Alice","bio":"Builder","imageUrl":"image","description":"About"}'));

    assert.entityCount("Metadata", 1);
    assert.fieldEquals("Metadata", CID, "name", "Alice");
    assert.fieldEquals("Metadata", CID, "bio", "Builder");
    assert.fieldEquals("Metadata", CID, "imageUrl", "image");
    assert.fieldEquals("Metadata", CID, "description", "About");
  });

  test("stores an empty object as controlled absent scalar metadata", () => {
    dataSourceMock.setAddress(CID);
    handleMetadata(Bytes.fromUTF8("{}"));

    const metadata = Metadata.load(CID);
    assert.assertNotNull(metadata);
    assert.assertNull(metadata!.name);
    assert.assertNull(metadata!.bio);
    assert.assertNull(metadata!.imageUrl);
    assert.assertNull(metadata!.description);
  });

  test("ignores malformed and non-object JSON without trapping", () => {
    dataSourceMock.setAddress(CID);
    handleMetadata(Bytes.fromUTF8("not json"));
    assert.notInStore("Metadata", CID);

    handleMetadata(Bytes.fromUTF8("[1,2,3]"));
    assert.notInStore("Metadata", CID);
  });

  test("uses template identity rather than a local dedupe guard", () => {
    dataSourceMock.setAddress(CID);
    handleMetadata(Bytes.fromUTF8('{"name":"first"}'));
    handleMetadata(Bytes.fromUTF8('{"name":"second"}'));

    assert.entityCount("Metadata", 1);
    assert.fieldEquals("Metadata", CID, "name", "second");
  });
});
