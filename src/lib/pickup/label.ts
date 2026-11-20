import type { Registration, Printer, Arrival } from "./model";
const hex_ = (text: string) =>
  Array.from(Buffer.from(text, "utf8"))
    .map((b) => "_" + b.toString(16).padStart(2, "0").toUpperCase())
    .join("");
export function renderZpl_(
  r: Pick<Registration, "name" | "phone" | "householdSize" | "pickupType">,
  p: Printer,
  copies: number,
  arrival: Arrival | null,
) {
  // Proportional layout: text scales to fill the configured label, so the same code
  // works for 2.25 x 1.25 in and 4 x 2 in stock at 203 or 300 dpi.
  const W = Math.round(p.widthIn * p.dpi),
    H = Math.round(p.heightIn * p.dpi),
    m = Math.round(0.06 * p.dpi),
    aw = W - 2 * m,
    ah = H - 2 * m;
  // Font A0 with width equal to height prints at normal proportions. 0.62 of the width
  // per character is a cautious estimate (about 0.5 was measured on a ZD421).
  const CF = 0.62;
  const room = (text: string, h: number, space?: number) =>
    Math.min(h, Math.floor((space || aw) / (text.length * CF)));
  const vehicle = arrival && arrival.vehicle ? arrival.vehicle : "";
  const prepacked = r.pickupType === "prepacked";
  const phone = "Phone: " + r.phone,
    household = "Household: " + r.householdSize + " people";
  function units(nameLines: number) {
    let t = 0;
    if (arrival) t += 2.0 + 0.3;
    t += nameLines * 1.4 + (nameLines - 1) * 0.15 + 0.3;
    if (prepacked) t += 1.1 + 0.25;
    if (vehicle) t += 1.0 + 0.25;
    return t + 1.0 + 0.25 + 1.0;
  }
  const unitFor = (lines: number) => Math.min(ah / units(lines), 0.25 * p.dpi);
  function split(name: string) {
    const words = name.split(" ");
    let best: string[] | null = null;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(" "),
        b = words.slice(i).join(" ");
      if (
        !best ||
        Math.max(a.length, b.length) < Math.max(best[0].length, best[1].length)
      )
        best = [a, b];
    }
    return best || [name];
  }
  let u = unitFor(1),
    nameLines = [r.name];
  if (room(r.name, 1.4 * u) < 0.7 * 1.4 * u) {
    const two = split(r.name);
    if (two.length === 2) {
      nameLines = two;
      u = unitFor(2);
    }
  }
  const nameH = Math.round(1.4 * u),
    nameW = Math.min(...nameLines.map((t) => room(t, nameH)));
  if (nameW < 0.45 * nameH)
    throw new Error(
      "Name is too long for this label. Review the source or the label size.",
    );
  const out = ["^XA", "^CI28", "^PW" + W, "^LL" + H, "^LH0,0"];
  let y = m;
  function field(
    text: string,
    h: number,
    w: number,
    x: number,
    reverse: boolean,
  ) {
    out.push(
      "^FO" +
        x +
        "," +
        y +
        "^A0N," +
        h +
        "," +
        w +
        (reverse ? "^FR" : "") +
        "^FH_^FD" +
        hex_(text) +
        "^FS",
    );
  }
  function line(text: string, h: number, gapAfter: number) {
    const w = room(text, h);
    if (w < 0.45 * h)
      throw new Error(
        "Label text does not fit this label: " + text.length + " characters.",
      );
    field(text, h, w, m, false);
    y += h + Math.round(gapAfter * u);
  }
  if (arrival) {
    // Header: car number left, line word in a box right. ORANGE is white on black so the
    // two lines look different at a glance on a black-only thermal label.
    const numH = Math.round(1.6 * u),
      boxH = Math.round(2.0 * u),
      wordH = Math.round(1.2 * u),
      padX = Math.round(0.35 * u),
      wordW = wordH,
      boxW = Math.ceil(6 * CF * wordW) + 2 * padX,
      word = arrival.line === "orange" ? "ORANGE" : "BLUE",
      boxX = W - m - boxW,
      number = "#" + arrival.number;
    if (number.length * CF * numH + boxW + padX > aw)
      throw new Error("Label is too narrow for the car number and line.");
    const top = y;
    y = top + Math.round((boxH - numH) / 2);
    field(number, numH, numH, m, false);
    y = top;
    out.push(
      "^FO" +
        boxX +
        "," +
        top +
        "^GB" +
        boxW +
        "," +
        boxH +
        "," +
        (arrival.line === "orange"
          ? boxH
          : Math.max(3, Math.round(0.03 * p.dpi))) +
        "^FS",
    );
    y = top + Math.round((boxH - wordH) / 2);
    field(
      word,
      wordH,
      wordW,
      boxX + Math.round((boxW - word.length * CF * wordW) / 2),
      arrival.line === "orange",
    );
    y = top + boxH + Math.round(0.3 * u);
  }
  if (prepacked) {
    // Walk-up households get a white-on-black bar so packers grab a pre-packed box.
    const barH = Math.round(1.1 * u),
      textH = Math.round(0.8 * u),
      text = "PRE-PACKED PICKUP",
      w = room(text, textH, aw - Math.round(0.6 * u)),
      top = y;
    out.push(
      "^FO" + m + "," + top + "^GB" + aw + "," + barH + "," + barH + "^FS",
    );
    y = top + Math.round((barH - textH) / 2);
    field(
      text,
      textH,
      w,
      m + Math.max(0, Math.round((aw - text.length * CF * w) / 2)),
      true,
    );
    y = top + barH + Math.round(0.25 * u);
  }
  nameLines.forEach((t, i) => {
    field(t, nameH, nameW, m, false);
    y += nameH + Math.round((i < nameLines.length - 1 ? 0.15 : 0.3) * u);
  });
  const detailH = Math.round(u);
  if (vehicle) line(vehicle, detailH, 0.25);
  line(phone, detailH, 0.25);
  line(household, detailH, 0);
  if (y > H - m + 2) throw new Error("Label is too short for these fields.");
  out.push("^PQ" + copies, "^XZ");
  return out.join("\n");
}
