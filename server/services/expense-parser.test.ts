import assert from "node:assert/strict";
import { parseExpenseMessage, type ParserCategory, type ParserUser } from "./expense-parser";

const users: ParserUser[] = [
  { id: "u1", name: "Murali", username: "murali" },
  { id: "u2", name: "Ganesh", username: "gani" },
  { id: "u3", name: "Bhanu", username: "bhanu" },
  { id: "u4", name: "Vinay", username: "vinay" },
  { id: "u5", name: "Narendra", username: "narendra" },
  { id: "u6", name: "Kiran", username: "kiran" },
];

const categories: ParserCategory[] = [
  { id: "c1", name: "Food" },
  { id: "c2", name: "Groceries" },
  { id: "c3", name: "Rent" },
  { id: "c4", name: "Internet" },
  { id: "c5", name: "Power" },
  { id: "c6", name: "Others" },
];

const sender = users[0];
const now = new Date("2026-04-11T10:00:00.000Z");

function run(input: string) {
  return parseExpenseMessage({ text: input, users, categories, sender, now });
}

function mustOne(input: string) {
  const out = run(input);
  assert.equal(out.length, 1, `Expected one expense for: ${input}. Got ${JSON.stringify(out)}`);
  return out[0];
}

function assertParticipantNames(actualIds: string[], expectedIds: string[]) {
  const a = [...actualIds].sort();
  const e = [...expectedIds].sort();
  assert.deepEqual(a, e);
}

function testSimple() {
  const a = mustOne("Curd 30");
  assert.equal(a.type, "curd");
  assert.equal(a.amount, 30);

  const b = mustOne("Veg 100");
  assert.equal(b.type, "veg");
  assert.equal(b.amount, 100);
}

function testMultiline() {
  const out = run("Oil 200\nVeggies 100");
  assert.equal(out.length, 2);
  assert.equal(out[0].type, "oil");
  assert.equal(out[0].amount, 200);
  assert.equal(out[1].type, "veggies");
  assert.equal(out[1].amount, 100);
}

function testCombinedAndSymbols() {
  const a = mustOne("Milk+tea 35");
  assert.equal(a.type, "milk+tea");
  assert.equal(a.amount, 35);

  const b = mustOne("Veg and oil 290");
  assert.equal(b.type, "veg and oil");
  assert.equal(b.amount, 290);

  assert.equal(mustOne("Curd = 30").amount, 30);
  assert.equal(mustOne("Water-30").type, "water");
  assert.equal(mustOne("Veggies: 50").amount, 50);
}

function testDates() {
  const a = mustOne("27th Aug 30 curd");
  assert.equal(a.date, "2026-08-27");
  assert.equal(a.type, "curd");
  assert.equal(a.amount, 30);

  const b = mustOne("21/8/22 onions 15");
  assert.equal(b.date, "2022-08-21");
  assert.equal(b.type, "onions");
  assert.equal(b.amount, 15);

  const c = mustOne("Yesterday vegetables 50");
  assert.equal(c.date, "2026-04-10");

  const d = mustOne("Today veg 100");
  assert.equal(d.date, "2026-04-11");
}

function testAmountOnly() {
  const a = mustOne("300");
  assert.equal(a.type, "general");
  assert.equal(a.amount, 300);
  assert.equal(a.userSelectionMode, "default-all");

  const b = mustOne("Yesterday expense 920");
  assert.equal(b.type, "general");
  assert.equal(b.amount, 920);
  assert.equal(b.date, "2026-04-10");
}

function testMixedNaturalLanguage() {
  const out = run("Me and vinay vegetables 75 and chips 50");
  assert.equal(out.length, 2);
  assert.equal(out[0].type, "vegetables");
  assert.equal(out[1].type, "chips");

  for (const e of out) {
    assert.equal(e.userSelectionMode, "mentioned");
    assertParticipantNames(
      e.participants.map((p) => p.id),
      ["u1", "u4"]
    );
  }
}

function testSplitFormatsAndNameMatching() {
  const each = mustOne("Murali Ganesh Bhanu each 255");
  assert.equal(each.amount, 765);
  assert.equal(each.splits.length, 3);
  assertParticipantNames(each.splits.map((s) => s.userId), ["u1", "u2", "u3"]);

  const named = mustOne("Chicken 1000 Murali 250 Gani 250 Bhanu 250");
  assert.equal(named.type, "chicken");
  assert.equal(named.amount, 1000);
  assert.equal(named.splits.length, 3);
  assertParticipantNames(named.splits.map((s) => s.userId), ["u1", "u2", "u3"]);

  const noTotalNamed = mustOne("chicken gani 250 murali 250");
  assert.equal(noTotalNamed.type, "chicken");
  assert.equal(noTotalNamed.amount, 500);
  assert.equal(noTotalNamed.splits.length, 2);
  assertParticipantNames(noTotalNamed.splits.map((s) => s.userId), ["u1", "u2"]);
}

function testCategoryDetectionKeywords() {
  assert.equal(mustOne("Rent 12000").categoryHint?.toLowerCase(), "rent");
  assert.equal(mustOne("wifi 900").categoryHint?.toLowerCase(), "internet");
  assert.equal(mustOne("current 450").categoryHint?.toLowerCase(), "power");
  assert.equal(mustOne("gas 1200").categoryHint?.toLowerCase(), "others");
  assert.equal(mustOne("groceries 500").categoryHint?.toLowerCase(), "groceries");
}

function testRealChatPatterns() {
  const cake = mustOne("Cake 710");
  assert.equal(cake.type, "cake");
  assert.equal(cake.amount, 710);

  const amtFirstMulti = run("130 curries and 75 vegetables");
  assert.equal(amtFirstMulti.length, 2);
  assert.equal(amtFirstMulti[0].amount, 130);
  assert.equal(amtFirstMulti[0].type, "curries");
  assert.equal(amtFirstMulti[1].amount, 75);
  assert.equal(amtFirstMulti[1].type, "vegetables");

  const eachNoNames = mustOne("Chicken each 110");
  assert.equal(eachNoNames.type, "chicken");
  assert.equal(eachNoNames.amount, 110);
  assert.equal(eachNoNames.perHeadAmount, 110);
  assert.equal(eachNoNames.userSelectionMode, "default-all");
  assert.equal(eachNoNames.splits.length, 0);

  const eachVariant1 = mustOne("chicken 200 each");
  assert.equal(eachVariant1.type, "chicken");
  assert.equal(eachVariant1.amount, 200);
  assert.equal(eachVariant1.perHeadAmount, 200);
  assert.equal(eachVariant1.userSelectionMode, "default-all");
  assert.equal(eachVariant1.splits.length, 0);

  const eachVariant2 = mustOne("chicken each 200");
  assert.equal(eachVariant2.type, "chicken");
  assert.equal(eachVariant2.amount, 200);
  assert.equal(eachVariant2.perHeadAmount, 200);
  assert.equal(eachVariant2.userSelectionMode, "default-all");
  assert.equal(eachVariant2.splits.length, 0);

  const eachVariant3 = mustOne("each chicken 200");
  assert.equal(eachVariant3.type, "chicken");
  assert.equal(eachVariant3.amount, 200);
  assert.equal(eachVariant3.perHeadAmount, 200);
  assert.equal(eachVariant3.userSelectionMode, "default-all");
  assert.equal(eachVariant3.splits.length, 0);

  const eachVariant4 = mustOne("200 chicken each");
  assert.equal(eachVariant4.type, "chicken");
  assert.equal(eachVariant4.amount, 200);
  assert.equal(eachVariant4.perHeadAmount, 200);
  assert.equal(eachVariant4.userSelectionMode, "default-all");
  assert.equal(eachVariant4.splits.length, 0);

  const personDash = mustOne("Balaji-630 means to balaji 630");
  assert.equal(personDash.amount, 630);
  assert.equal(personDash.type, "balaji");

  const plusExpr = mustOne("Narendra 27+16");
  assert.equal(plusExpr.amount, 43);
  assert.equal(plusExpr.type, "narendra");

  const combinedItem = mustOne("Chicken +sprite 620");
  assert.equal(combinedItem.type, "chicken +sprite");
  assert.equal(combinedItem.amount, 620);

  const amountThenNames = mustOne("500\nbhanu\nnarendra\nganesh");
  assert.equal(amountThenNames.type, "general");
  assert.equal(amountThenNames.amount, 500);
  assert.equal(amountThenNames.userSelectionMode, "mentioned");
  assertParticipantNames(amountThenNames.participants.map((p) => p.id), ["u2", "u3", "u5"]);

  const typedAmountThenNames = mustOne("chicken 250\nmurali\nnarendra");
  assert.equal(typedAmountThenNames.type, "chicken");
  assert.equal(typedAmountThenNames.amount, 250);
  assert.equal(typedAmountThenNames.userSelectionMode, "mentioned");
  assertParticipantNames(typedAmountThenNames.participants.map((p) => p.id), ["u1", "u5"]);

  const oneLineAmountThenNames = mustOne("500 bhanu narendra ganesh");
  assert.equal(oneLineAmountThenNames.type, "general");
  assert.equal(oneLineAmountThenNames.amount, 500);
  assert.equal(oneLineAmountThenNames.userSelectionMode, "mentioned");
  assertParticipantNames(oneLineAmountThenNames.participants.map((p) => p.id), ["u2", "u3", "u5"]);

  const multilineTypeNamed = mustOne("Food\nGanesh 110\nKiran 220\nBhanu 100\nNarendra 20");
  assert.equal(multilineTypeNamed.type, "food");
  assert.equal(multilineTypeNamed.amount, 450);
  assert.equal(multilineTypeNamed.userSelectionMode, "mentioned");
  assert.equal(multilineTypeNamed.splits.length, 4);
  assertParticipantNames(multilineTypeNamed.participants.map((p) => p.id), ["u2", "u3", "u5", "u6"]);

  const multilineTypeEach = mustOne("Food each 220\nKiran\nGanesh\nMurali\nBhanu");
  assert.equal(multilineTypeEach.type, "food");
  assert.equal(multilineTypeEach.amount, 880);
  assert.equal(multilineTypeEach.userSelectionMode, "mentioned");
  assert.equal(multilineTypeEach.splits.length, 4);
  for (const split of multilineTypeEach.splits) {
    assert.equal(split.amount, 220);
  }
  assertParticipantNames(multilineTypeEach.participants.map((p) => p.id), ["u1", "u2", "u3", "u6"]);
}

function runAll() {
  testSimple();
  testMultiline();
  testCombinedAndSymbols();
  testDates();
  testAmountOnly();
  testMixedNaturalLanguage();
  testSplitFormatsAndNameMatching();
  testCategoryDetectionKeywords();
  testRealChatPatterns();
  console.log("All parser tests passed.");
}

runAll();
