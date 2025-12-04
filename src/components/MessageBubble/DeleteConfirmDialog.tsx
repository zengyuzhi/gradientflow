import React from 'react';
import { Trash2 } from 'lucide-react';
import './styles.css';

interface DeleteConfirmDialogProps {
    onCancel: () => void;
    onConfirm: () => void;
    isDeleting: boolean;
    error: string | null;
}

export const DeleteConfirmDialog: React.FC<DeleteConfirmDialogProps> = ({
    onCancel,
    onConfirm,
    isDeleting,
    error,
}) => {
    return (
        <div className="delete-confirm-card">
            <div className="delete-icon-wrapper">
                <Trash2 size={20} className="delete-icon-svg" />
            </div>
            <div className="delete-content-col">
                <span className="delete-title">删除消息？</span>
                <span className="delete-subtitle">此操作无法撤销。</span>
            </div>
            {error && <span className="delete-error">{error}</span>}
            <div className="delete-confirm-actions">
                <button className="delete-confirm-btn ghost" onClick={onCancel} disabled={isDeleting}>
                    取消
                </button>
                <button
                    className="delete-confirm-btn destructive"
                    onClick={onConfirm}
                    disabled={isDeleting}
                >
                    {isDeleting ? '正在删除...' : '删除'}
                </button>
            </div>
        </div>
    );
};
