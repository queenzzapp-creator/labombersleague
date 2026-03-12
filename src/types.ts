export interface User {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface Category {
  id: string;
  name: string;
  description?: string;
}

export interface ChallengeFile {
  id: string;
  challengeId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  downloadUrl?: string;
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  categoryId: string;
  imageUrl?: string;
  youtubeUrl?: string;
  scoringType: 'TIME_ASC' | 'TIME_DESC' | 'COUNT_DESC';
  files?: ChallengeFile[];
}

export interface Result {
  userId: string;
  userName: string;
  avatarUrl?: string;
  userAvatar?: string;
  challengeId: string;
  challengeTitle?: string;
  timeMs: number;
  score?: number;
  timestamp: string;
}
