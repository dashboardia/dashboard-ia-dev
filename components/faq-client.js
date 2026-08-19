"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { usePreferences } from "./preferences-provider";

export default function FaqClient({ articles }) {
  const { t } = usePreferences();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const categories = [...new Set(articles.map((article) => article.category))];
  const filtered = useMemo(() => articles.filter((article) => (!category || article.category === category) && `${article.title} ${article.answer}`.toLowerCase().includes(query.toLowerCase())), [articles, category, query]);
  return <><div className="faq-tools"><label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchFaq")} /></label><button className={!category ? "active" : ""} onClick={() => setCategory("")}>{t("all")}</button>{categories.map((item) => <button className={category === item ? "active" : ""} onClick={() => setCategory(item)} key={item}>{item}</button>)}</div><div className="faq-list">{filtered.map((article) => <details key={article.id}><summary><span>{article.category}</span>{article.title}</summary><p>{article.answer}</p></details>)}{!filtered.length && <p className="list-empty">{t("noResults")}</p>}</div></>;
}
