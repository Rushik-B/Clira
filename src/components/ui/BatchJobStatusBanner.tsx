'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  RefreshCw, 
  X,
  BarChart3,
  Mail
} from 'lucide-react';

interface BatchJobStatus {
  hasRunningJob: boolean;
  runningJob?: {
    id: string;
    status: string;
    startedAt: Date;
    emailsProcessed: number;
    emailsSorted: number;
    emailsToReview: number;
  };
  recentJobs: Array<{
    id: string;
    status: string;
    startedAt: Date;
    completedAt: Date | null;
    emailsProcessed: number;
    emailsSorted: number;
    emailsToReview: number;
    errorMessage: string | null;
  }>;
  canModifyFolders: boolean;
  recommendation: string;
}

interface BatchJobStatusBannerProps {
  onStatusChange?: (canModify: boolean) => void;
  refreshInterval?: number; // milliseconds
}

export const BatchJobStatusBanner: React.FC<BatchJobStatusBannerProps> = ({
  onStatusChange,
  refreshInterval = 30000 // 30 seconds
}) => {
  const [status, setStatus] = useState<BatchJobStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/batch-jobs/status');
      const data = await response.json();

      if (data.success) {
        const newStatus = {
          ...data.data,
          runningJob: data.data.runningJob ? {
            ...data.data.runningJob,
            startedAt: new Date(data.data.runningJob.startedAt)
          } : undefined,
          recentJobs: data.data.recentJobs.map((job: any) => ({
            ...job,
            startedAt: new Date(job.startedAt),
            completedAt: job.completedAt ? new Date(job.completedAt) : null
          }))
        };
        
        setStatus(newStatus);
        onStatusChange?.(newStatus.canModifyFolders);
        setError(null);
      } else {
        setError(data.error || 'Failed to fetch batch job status');
      }
    } catch (error) {
      console.error('Error fetching batch job status:', error);
      setError('Failed to fetch batch job status');
    } finally {
      setLoading(false);
    }
  }, [onStatusChange]);

  useEffect(() => {
    fetchStatus();

    // Set up polling if there's a running job or refresh interval is specified
    const interval = setInterval(fetchStatus, refreshInterval);

    return () => clearInterval(interval);
  }, [refreshInterval, fetchStatus]);

  // Auto-refresh more frequently if there's a running job
  useEffect(() => {
    if (status?.hasRunningJob) {
      const fastInterval = setInterval(fetchStatus, 10000); // 10 seconds
      return () => clearInterval(fastInterval);
    }
  }, [status?.hasRunningJob, fetchStatus]);

  const formatDuration = (startTime: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - startTime.getTime();
    const minutes = Math.floor(diffMs / (1000 * 60));
    const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
    
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  };

  if (loading) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 mb-4">
        <div className="flex items-center space-x-2">
          <RefreshCw className="w-4 h-4 text-gray-400 animate-spin" />
          <span className="text-gray-400 text-sm">Checking batch job status...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-800 rounded-lg p-3 mb-4">
        <div className="flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          <span className="text-red-300 text-sm">{error}</span>
        </div>
      </div>
    );
  }

  if (!status) return null;

  // Don't show banner if dismissed and no running job
  if (dismissed && !status.hasRunningJob) return null;

  // Show warning if there's a running job
  if (status.hasRunningJob && status.runningJob) {
    return (
      <div className="bg-yellow-900/20 border border-yellow-800 rounded-lg p-4 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3">
            <Clock className="w-5 h-5 text-yellow-400 mt-0.5" />
            <div>
              <h3 className="text-yellow-300 font-medium">Email Processing In Progress</h3>
              <p className="text-yellow-200 text-sm mt-1">
                Folder modifications are temporarily disabled to prevent conflicts during batch processing.
              </p>
              <div className="mt-3 grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-yellow-400">Runtime:</span>
                  <span className="text-yellow-200 ml-2">
                    {formatDuration(status.runningJob.startedAt)}
                  </span>
                </div>
                <div>
                  <span className="text-yellow-400">Processed:</span>
                  <span className="text-yellow-200 ml-2">
                    {status.runningJob.emailsProcessed} emails
                  </span>
                </div>
                <div>
                  <span className="text-yellow-400">Sorted:</span>
                  <span className="text-yellow-200 ml-2">
                    {status.runningJob.emailsSorted} emails
                  </span>
                </div>
              </div>
              <div className="mt-2 flex items-center space-x-2">
                <RefreshCw className="w-3 h-3 text-yellow-400 animate-spin" />
                <span className="text-yellow-300 text-xs">Auto-refreshing every 10 seconds</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show success message if just completed
  const lastJob = status.recentJobs[0];
  if (lastJob && !dismissed) {
    const timeSinceCompletion = lastJob.completedAt 
      ? Date.now() - lastJob.completedAt.getTime()
      : Date.now() - lastJob.startedAt.getTime();
    
    // Show completion banner for 5 minutes after completion
    if (timeSinceCompletion < 5 * 60 * 1000 && lastJob.status === 'completed') {
      return (
        <div className="bg-green-900/20 border border-green-800 rounded-lg p-4 mb-6">
          <div className="flex items-start justify-between">
            <div className="flex items-start space-x-3">
              <CheckCircle className="w-5 h-5 text-green-400 mt-0.5" />
              <div>
                <h3 className="text-green-300 font-medium">Email Processing Complete</h3>
                <p className="text-green-200 text-sm mt-1">
                  All folder modifications are now safe to perform.
                </p>
                <div className="mt-2 grid grid-cols-3 gap-4 text-sm">
                  <div className="flex items-center space-x-1">
                    <Mail className="w-3 h-3 text-green-400" />
                    <span className="text-green-400">Processed:</span>
                    <span className="text-green-200">{lastJob.emailsProcessed}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <BarChart3 className="w-3 h-3 text-green-400" />
                    <span className="text-green-400">Sorted:</span>
                    <span className="text-green-200">{lastJob.emailsSorted}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <AlertTriangle className="w-3 h-3 text-green-400" />
                    <span className="text-green-400">Review:</span>
                    <span className="text-green-200">{lastJob.emailsToReview}</span>
                  </div>
                </div>
              </div>
            </div>
            <button
              onClick={() => setDismissed(true)}
              className="p-1 text-green-400 hover:text-green-300 hover:bg-green-900/30 rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      );
    }
  }

  return null;
};