const XLSX = require('xlsx');
const path = require('path');

// Create a new workbook
const workbook = XLSX.utils.book_new();

// Create MCQ Questions sheet
const mcqData = [
  ['Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Correct Answer'],
  ['What is the primary purpose of React?', 'Styling', 'State management', 'Building user interfaces', 'Database management', 'Building user interfaces'],
  ['Which hook is used to manage state in functional components?', 'useState', 'useEffect', 'useContext', 'useRef', 'useState'],
  ['React is maintained by which company?', 'Google', 'Microsoft', 'Facebook', 'Amazon', 'Facebook'],
  ['What is JSX in React?', 'JavaScript XML', 'Java Syntax Extension', 'JSON Extension', 'Java XML Syntax', 'JavaScript XML'],
  ['What is the virtual DOM?', 'A database', 'A lightweight copy of the real DOM', 'A new browser API', 'A React hook', 'A lightweight copy of the real DOM'],
  ['Which method is used to render React components?', 'render()', 'display()', 'show()', 'mount()', 'render()'],
  ['Props in React are?', 'Immutable', 'Mutable', 'Both', 'None', 'Immutable'],
  ['Which of the following is a React hook for side effects?', 'useState', 'useEffect', 'useMemo', 'useCallback', 'useEffect'],
  ['Which file extension is commonly used for React components?', '.react', '.jsx', '.jsreact', '.component', '.jsx'],
  ['What is the correct syntax for exporting a component?', 'export Component;', 'export default Component;', 'export = Component;', 'default export Component;', 'export default Component;']
];

const mcqSheet = XLSX.utils.aoa_to_sheet(mcqData);
XLSX.utils.book_append_sheet(workbook, mcqSheet, 'MCQ Questions');

// Create Voice Questions sheet
const voiceData = [
  ['Question Number', 'Question Text'],
  [1, 'Describe your experience working with React components.'],
  [2, 'How do you handle state management in large applications?'],
  [3, 'Explain how React differs from other frontend frameworks.'],
  [4, 'Can you describe the lifecycle of a React component?'],
  [5, 'How do you optimize performance in a React application?']
];

const voiceSheet = XLSX.utils.aoa_to_sheet(voiceData);
XLSX.utils.book_append_sheet(workbook, voiceSheet, 'Voice Questions');

// Write the workbook to a file
const templatePath = path.join(__dirname, '..', 'workingfrontendskillmatrix', 'src', 'assets', 'templates', 'Recruitment_Assessment_Template.xlsx');
XLSX.writeFile(workbook, templatePath);

console.log('Excel template created successfully at:', templatePath);