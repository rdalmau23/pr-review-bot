# 🤖 PR Review Bot

Automate your pull request reviews and keep your team in sync. This bot monitors GitHub PR activity and sends automated digests and priority alerts directly to Slack.

![Architecture Diagram](https://mermaid.ink/img/pako:eNptkcsOwjAMRX9l5FUXfIAf6AKR2CwbN6YlbRUnRSL-neZBeYDFZ-zjc5I7UAnV6ZIn6WAn5CAt7InSogJ_xS67S8GvX6V0_O-6i6hAn7En6mBPaVGH63zLkzSwE3KQFn5OadGf8R59S_76r-zM71IK9At7on5hD09S6mAn5CAt_KzSot9Smu4X7_H6_K_8L_o3yv9M_wI?type=png)

## 🚀 Features

- **GitHub Multi-Repo Support**: Track multiple repositories across your organization.
- **Slack Digests**: Daily summaries of pending PRs, workload, and stale requests.
- **Priority Scoring**: Automatically highlights urgent or blocking code changes.
- **Stale PR Detection**: Alerts reviewers when a PR hasn't been touched for too long.
- **Worker-Based Architecture**: Efficient background processing using BullMQ and Redis.

## 🛠 Tech Stack

- **Runtime**: Node.js + TypeScript
- **Web**: Express
- **Slack SDK**: @slack/bolt
- **GitHub SDK**: @octokit/rest
- **Database**: PostgreSQL + Prisma
- **Job Queue**: BullMQ + Redis

## 📄 License
MIT
