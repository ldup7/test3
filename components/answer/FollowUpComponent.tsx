import { IconPlus } from '@/components/ui/icons';

interface FollowUp {
    followUp: string[];
}

const FollowUpComponent = ({ followUp, handleFollowUpClick }: { followUp: FollowUp; handleFollowUpClick: (question: string) => void }) => {
    const handleQuestionClick = (question: string) => {
        handleFollowUpClick(question);
    };

    return (
        <div className="dark:bg-slate-800 bg-white shadow-lg rounded-lg p-4 mt-4">
            <div className="flex items-center">
                <h2 className="text-lg font-semibold flex-grow dark:text-white text-black">Follow-Up</h2>
            </div>
            <ul className="mt-2">
                {followUp.followUp && followUp.followUp.map((question, index) => (
                    <li
                        key={index}
                        className="flex items-center mt-2 cursor-pointer"
                        onClick={() => handleQuestionClick(question)}
                    >
                        <span role="img" aria-label="link" className="mr-2 dark:text-white text-black">
                            <IconPlus />
                        </span>
                        <p className="dark:text-white text-black hover:underline">{question}</p>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default FollowUpComponent;
