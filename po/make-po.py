#!/usr/bin/python3
# -*- coding: utf-8 -*-
# Genera po/<idioma>.po a partir de po/mintmotion.pot y po/translations.py.
# Solo hace falta para crear los catálogos de nuevo; para corregir una
# traducción, edita el .po. Avisa de los textos sin traducir.
import os
import re
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from translations import LANGS  # noqa: E402


def unq(s):
    return bytes(s[1:-1], "utf-8").decode("unicode_escape").encode("latin-1").decode("utf-8")


def q(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def parse_pot(path):
    entries, cur, key = [], None, None
    for line in open(path, encoding="utf-8").read().splitlines() + [""]:
        if not line.strip():
            if cur and cur.get("msgid") is not None:
                entries.append(cur)
            cur, key = None, None
            continue
        cur = cur or {"comments": []}
        if line.startswith("#"):
            cur["comments"].append(line)
            continue
        m = re.match(r'^(msgid_plural|msgid|msgstr(?:\[\d\])?) (".*")$', line)
        if m:
            key = m.group(1)
            cur[key] = unq(m.group(2))
        elif line.startswith('"') and key:
            cur[key] += unq(line)
    return [e for e in entries if e["msgid"]]


def main():
    entries = parse_pot(os.path.join(HERE, "mintmotion.pot"))
    now = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M%z")
    for code, (table, name, plural) in LANGS.items():
        out = [f"# {name} translation of MintMotion.",
               "# Copyright (C) 2026 José Antonio Ramos Miralles",
               "# This file is distributed under the same license as the mintmotion package.",
               "#", 'msgid ""', 'msgstr ""',
               q("Project-Id-Version: mintmotion\n"),
               q("Report-Msgid-Bugs-To: hola@joseantonioramos.es\n"),
               q(f"PO-Revision-Date: {now}\n"),
               q("Last-Translator: José Antonio Ramos Miralles <hola@joseantonioramos.es>\n"),
               q(f"Language-Team: {name}\n"), q(f"Language: {code}\n"),
               q("MIME-Version: 1.0\n"), q("Content-Type: text/plain; charset=UTF-8\n"),
               q("Content-Transfer-Encoding: 8bit\n"), q(f"Plural-Forms: {plural}\n"), ""]
        missing = 0
        nplurals = int(re.search(r"nplurals=(\d+)", plural).group(1))
        for e in entries:
            out += e["comments"]
            out.append("msgid " + q(e["msgid"]))
            if "msgid_plural" in e:
                out.append("msgid_plural " + q(e["msgid_plural"]))
                tr = table.get((e["msgid"], e["msgid_plural"]))
                if not tr:
                    missing += 1
                    tr = [""] * nplurals
                for i in range(nplurals):
                    out.append(f"msgstr[{i}] " + q(tr[min(i, len(tr) - 1)]))
            else:
                tr = table.get(e["msgid"])
                if tr is None:
                    missing += 1
                    print(f"  {code}: sin traducir: {e['msgid']!r}")
                out.append("msgstr " + q(tr or ""))
            out.append("")
        with open(os.path.join(HERE, f"{code}.po"), "w", encoding="utf-8") as f:
            f.write("\n".join(out))
        print(f"{code}.po: {len(entries)} textos, {missing} sin traducir")


if __name__ == "__main__":
    main()
