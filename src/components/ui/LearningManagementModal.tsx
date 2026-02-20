'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  X, 
  Brain, 
  Trash2, 
  ArrowRight, 
  Calendar, 
  User, 
  AlertCircle,
  CheckCircle,
  TrendingUp,
  BarChart3
} from 'lucide-react';

interface Learning {
  id: string;
  emailFrom: string;
  originalFolder: string;
  correctedFolder: string;
  userReason: string | null;
  aiSummary: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface LearningStats {
  totalLearnings: number;
  activeLearnings: number;
  recentLearnings: number;
  topSenders: Array<{ sender: string; count: number }>;
}

interface LearningManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  folderId: string;
  folderName: string;
}

export const LearningManagementModal: React.FC<LearningManagementModalProps> = ({
  isOpen,
  onClose,
  folderId,
  folderName
}) => {
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchLearnings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/folders/${folderId}/learnings`);
      const data = await response.json();

      if (data.success) {
        setLearnings(data.learnings.map((l: any) => ({
          ...l,
          createdAt: new Date(l.createdAt),
          updatedAt: new Date(l.updatedAt)
        })));
        setStats(data.stats);
      } else {
        setError(data.error || 'Failed to fetch learnings');
      }
    } catch (error) {
      console.error('Error fetching learnings:', error);
      setError('Failed to fetch learnings');
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  useEffect(() => {
    if (isOpen) {
      fetchLearnings();
    }
  }, [isOpen, folderId, fetchLearnings]);

  const deleteLearning = async (learningId: string) => {
    try {
      setDeletingId(learningId);

      const response = await fetch(`/api/folders/${folderId}/learnings?learningId=${learningId}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (data.success) {
        setSuccessMessage('Learning removed successfully');
        setTimeout(() => setSuccessMessage(null), 3000);
        await fetchLearnings(); // Refresh the list
      } else {
        setError(data.error || 'Failed to remove learning');
        setTimeout(() => setError(null), 5000);
      }
    } catch (error) {
      console.error('Error deleting learning:', error);
      setError('Failed to remove learning');
      setTimeout(() => setError(null), 5000);
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-lg border border-gray-800 w-full max-w-5xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Brain className="w-6 h-6 text-orange-400" />
              <div>
                <h2 className="text-xl font-semibold text-white">Learning Management</h2>
                <p className="text-gray-400">Manage AI learnings for "{folderName}" folder</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6">
          {/* Success Message */}
          {successMessage && (
            <div className="mb-6 flex items-center space-x-2 p-4 bg-green-900/20 rounded-lg border border-green-800">
              <CheckCircle className="w-5 h-5 text-green-400" />
              <span className="text-green-300">{successMessage}</span>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mb-6 flex items-center space-x-2 p-4 bg-red-900/20 rounded-lg border border-red-800">
              <AlertCircle className="w-5 h-5 text-red-400" />
              <span className="text-red-300">{error}</span>
            </div>
          )}

          {/* Statistics */}
          {stats && (
            <div className="mb-8 grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-400">Total Learnings</h3>
                  <BarChart3 className="w-4 h-4 text-blue-400" />
                </div>
                <div className="text-2xl font-bold text-white">{stats.totalLearnings}</div>
              </div>

              <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-400">Active</h3>
                  <CheckCircle className="w-4 h-4 text-green-400" />
                </div>
                <div className="text-2xl font-bold text-white">{stats.activeLearnings}</div>
              </div>

              <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-400">Recent (7d)</h3>
                  <TrendingUp className="w-4 h-4 text-purple-400" />
                </div>
                <div className="text-2xl font-bold text-white">{stats.recentLearnings}</div>
              </div>

              <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-400">Top Sender</h3>
                  <User className="w-4 h-4 text-orange-400" />
                </div>
                <div className="text-sm font-bold text-white truncate">
                  {stats.topSenders.length > 0 ? stats.topSenders[0].sender : 'None'}
                </div>
                <div className="text-xs text-gray-400">
                  {stats.topSenders.length > 0 ? `${stats.topSenders[0].count} corrections` : ''}
                </div>
              </div>
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-orange-400 border-t-transparent mx-auto mb-4"></div>
              <p className="text-gray-400">Loading learnings...</p>
            </div>
          )}

          {/* Learnings List */}
          {!loading && learnings.length === 0 ? (
            <div className="text-center py-12">
              <Brain className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-400 mb-2">No learnings found</h3>
              <p className="text-gray-500">Start correcting emails to create learnings that improve AI accuracy.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Learning History</h3>
              {learnings.map((learning) => (
                <div
                  key={learning.id}
                  className={`bg-gray-800 rounded-lg p-4 border transition-opacity ${
                    learning.isActive ? 'border-gray-700' : 'border-gray-700 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 space-y-3">
                      {/* Correction Path */}
                      <div className="flex items-center space-x-3">
                        <span className="px-2 py-1 bg-red-900/30 text-red-400 rounded text-sm">
                          {learning.originalFolder}
                        </span>
                        <ArrowRight className="w-4 h-4 text-gray-400" />
                        <span className="px-2 py-1 bg-green-900/30 text-green-400 rounded text-sm">
                          {learning.correctedFolder}
                        </span>
                      </div>

                      {/* Sender */}
                      <div className="flex items-center space-x-2">
                        <User className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-300 text-sm">From: {learning.emailFrom}</span>
                      </div>

                      {/* User Reason */}
                      {learning.userReason && (
                        <div>
                          <p className="text-xs text-gray-400 mb-1">User's reasoning:</p>
                          <p className="text-gray-200 text-sm italic">"{learning.userReason}"</p>
                        </div>
                      )}

                      {/* AI Summary */}
                      <div>
                        <p className="text-xs text-gray-400 mb-1">AI learning summary:</p>
                        <p className="text-gray-300 text-sm">{learning.aiSummary}</p>
                      </div>

                      {/* Metadata */}
                      <div className="flex items-center space-x-4 text-xs text-gray-500">
                        <div className="flex items-center space-x-1">
                          <Calendar className="w-3 h-3" />
                          <span>{formatDate(learning.createdAt)}</span>
                        </div>
                        {!learning.isActive && (
                          <span className="px-2 py-1 bg-gray-700 text-gray-400 rounded">
                            Inactive
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="ml-4">
                      <button
                        onClick={() => deleteLearning(learning.id)}
                        disabled={deletingId === learning.id}
                        className="p-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Remove this learning"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Top Senders */}
          {stats && stats.topSenders.length > 0 && (
            <div className="mt-8">
              <h3 className="text-lg font-semibold text-white mb-4">Most Corrected Senders</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {stats.topSenders.slice(0, 6).map((sender, index) => (
                  <div key={sender.sender} className="flex items-center justify-between bg-gray-800 rounded-lg p-3 border border-gray-700">
                    <div className="flex items-center space-x-3">
                      <div className="w-6 h-6 bg-orange-900/30 text-orange-400 rounded-full flex items-center justify-center text-xs font-medium">
                        {index + 1}
                      </div>
                      <span className="text-gray-200 text-sm truncate">{sender.sender}</span>
                    </div>
                    <span className="text-orange-400 text-sm font-medium">{sender.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};