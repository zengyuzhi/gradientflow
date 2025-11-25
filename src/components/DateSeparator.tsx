import React from 'react';
import { motion } from 'framer-motion';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import calendar from 'dayjs/plugin/calendar';

dayjs.extend(relativeTime);
dayjs.extend(calendar);

interface DateSeparatorProps {
    timestamp: number;
}

export const DateSeparator: React.FC<DateSeparatorProps> = ({ timestamp }) => {
    const dateLabel = getDateLabel(timestamp);

    return (
        <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="date-separator"
        >
            <div className="date-separator-line" />
            <span className="date-separator-text">{dateLabel}</span>
            <div className="date-separator-line" />
        </motion.div>
    );
};

function getDateLabel(timestamp: number): string {
    const date = dayjs(timestamp);
    const today = dayjs();

    if (date.isSame(today, 'day')) {
        return 'Today';
    } else if (date.isSame(today.subtract(1, 'day'), 'day')) {
        return 'Yesterday';
    } else {
        return date.format('MMM D, YYYY');
    }
}

/**
 * Helper function to determine if a date separator should be shown
 * between two messages
 */
export function shouldShowDateSeparator(
    currentMessage: { timestamp: number },
    previousMessage?: { timestamp: number }
): boolean {
    if (!previousMessage) return true;

    const currentDate = dayjs(currentMessage.timestamp);
    const previousDate = dayjs(previousMessage.timestamp);

    return !currentDate.isSame(previousDate, 'day');
}
