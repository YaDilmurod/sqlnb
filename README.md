# SQLNB Visualizer

**SQLNB Visualizer** is a lightning-fast, Jupyter-style SQL notebook extension for Visual Studio Code, built specifically for PostgreSQL data analysts. 

It provides an interactive, memory-safe environment to query databases and visualize results instantly—without ever leaving your editor.

![Smart DBeaver-style Table View](images/table.jpg)
![Interactive ECharts](images/chart.jpg)

## Core Features

* **Jupyter-Style SQL:** Mix Markdown, SQL queries, and interactive charts in `.sqlnb` files.
* **Smart Memory (DBeaver-Style):** Massive queries fetch data instantly via server-side cursors. Zero RAM spikes, no crashed editors, and instant row estimates via `EXPLAIN`.
* **Native ECharts Integration:** Add "Chart Cells" to instantly turn your SQL results (`df_1`, `df_2`) into dynamic, beautifully formatted Bar, Line, Scatter, and Pie charts.
* **Server-Side Sorting:** Click any column header to instantly re-sort millions of rows on the database side without losing your scroll position.
* **Query Safety:** Safely cancel runaway queries on the database server instantly by clicking "Stop Execution".

## Getting Started

1. **Connect:** Run `SQL Notebook: Connect to Database` (Cmd+Shift+P).
2. **Create:** Run `SQL Notebook: New Notebook` (or create a `.sqlnb` file).
3. **Query & Chart:** Write a SQL query, hit play, and then click **Add Chart Cell** to instantly visualize your results.

---

**Developed by Dilmurod Yarmukhamedov**  
[Connect with me on LinkedIn](https://www.linkedin.com/in/dilmurod-yarmukhamedov-946302205/)
