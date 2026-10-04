# -*- coding: utf-8 -*-
"""v165-N2 · 主线剧本机械抽取器

用法： python docs/_extract_chapters.py

从 docs/v165-第1-9章-剧本.md §4「剧本正文」里抽出 9 个 ```js 代码块（CH01..CH09），
原样写到 docs/_tmp/CH0N.js（LF），并拼一个 docs/_tmp/_all.js 供校验脚本 require。

⛔ 纪律（主理人裁定）：
  1. **机械抽取**，⛔ 禁手打、禁改字 —— 改剧情请改 md，然后重跑本脚本。
  2. 只收 §4 区间内、以 `^const CH0[1-9] = {` 开头的块（跳过 §0.2 等处的示例块）。
  3. 旧 8 章 CHAP_SCRIPTS 原样保留，本脚本绝不触碰。

六条校验（由 docs/_tmp/_chk.js 与 docs/_test_v165n2_script.js 跑）：
  9 章齐全 / 零断链 / end:true 恰好 9 处 / who 170 处 go 25 处 / 与 md 逐字节一致 / 旧 8 章逐字节未动
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MD = os.path.join(ROOT, "docs", "v165-第1-9章-剧本.md")
OUT = os.path.join(ROOT, "docs", "_tmp")


def main():
    src = open(MD, encoding="utf-8").read().replace("\r\n", "\n")
    lines = src.split("\n")
    i4 = next(i for i, l in enumerate(lines) if l.startswith("## §4"))
    i5 = next(i for i, l in enumerate(lines) if l.startswith("## §5"))

    blocks = []
    cur = None
    for l in lines[i4:i5]:
        if l.startswith("```js"):
            cur = []
            continue
        if l.startswith("```") and cur is not None:
            blocks.append("\n".join(cur))
            cur = None
            continue
        if cur is not None:
            cur.append(l)

    # ⛔ 只收以 `const CH0N = {` 开头的块（示例块 / 字段说明块一律跳过）
    keep = []
    for b in blocks:
        m = re.search(r"^const (CH0[1-9]) = \{", b, re.M)
        if m:
            keep.append((m.group(1), b))

    if not os.path.isdir(OUT):
        os.makedirs(OUT)
    names = []
    for name, body in keep:
        names.append(name)
        open(os.path.join(OUT, name + ".js"), "w", encoding="utf-8", newline="\n").write(body + "\n")
    alljs = "\n".join(b for _, b in keep) + "\nmodule.exports = {" + ",".join(names) + "};\n"
    open(os.path.join(OUT, "_all.js"), "w", encoding="utf-8", newline="\n").write(alljs)

    joined = "\n".join(b for _, b in keep)
    print("blocks(kept):", len(keep), names)
    print("who:", len(re.findall("who:", joined)))
    print("go:", len(re.findall("go:", joined)))
    print("end:true:", joined.count("end:true"))
    print("bytes:", len(joined.encode("utf-8")))


if __name__ == "__main__":
    main()
