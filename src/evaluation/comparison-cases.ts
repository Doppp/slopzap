import type { Platform, Unit } from '../shared/types';
export const COMPARISON_CASE_VERSION = 'invented-comparison-v1';
function example(
  id: string,
  platform: Platform,
  label: 0 | 1,
  text: string,
  parentText: string,
) {
  const unit: Unit = {
    platform,
    kind: platform === 'medium' ? 'article_response' : 'reply',
    id,
    parentId: null,
    text,
    parentText,
    rootText: '',
    quotedText: '',
  };
  return { id, label, unit };
}
// Newly invented examples, separate from the seed and reference guide. These
// author-intended labels are not independent ground truth or authorship labels.
export const COMPARISON_CASES = [
  example(
    'reddit-filler',
    'reddit',
    1,
    'Absolutely, what a valuable perspective! Better bicycle storage really is about better bicycle storage. Thank you for sharing this great insight with everyone.',
    'Our example building needs covered bicycle storage rather than more car parking.',
  ),
  example(
    'reddit-answer',
    'reddit',
    0,
    'The wall-mounted racks save floor space, but check whether residents can lift a loaded cargo bike onto them. A few ground-level stands would cover that gap.',
    'Which bicycle racks would work in our invented apartment courtyard?',
  ),
  example(
    'reddit-quotation',
    'reddit',
    0,
    'The reply “great insight and thank you for sharing” avoids the question. Which rack fits a wider tyre without pinching the brake cable?',
    'The example thread asks which rack suits a cargo bike.',
  ),
  example(
    'youtube-filler',
    'youtube',
    1,
    'Well said! In today’s ever-evolving landscape, it is not just about the bread but about unlocking our potential. Thank you for sharing this valuable perspective!',
    'The invented baking demonstration compares two dough resting times.',
  ),
  example(
    'youtube-question',
    'youtube',
    0,
    'At 04:18 the second bowl is noticeably warmer than the first. Did both doughs rest at the same room temperature before that comparison?',
    'The invented baking demonstration compares two dough resting times.',
  ),
  example(
    'youtube-paraphrase',
    'youtube',
    1,
    'Absolutely, great insight! The second dough rests longer and the crust changes. A valuable perspective on how a longer rest changes the crust. Thank you for sharing!',
    'The second example dough rests longer and its crust changes.',
  ),
  example(
    'linkedin-filler',
    'linkedin',
    1,
    'In today’s ever-evolving world, it is not just about meetings but about unlocking collective potential. Great insight! Thank you for sharing this valuable perspective on progress.',
    'Our fictional team removed the recurring Friday meeting.',
  ),
  example(
    'linkedin-caveat',
    'linkedin',
    0,
    'Great insight. Dropping the Friday meeting helped our fictional team, but the written handoff needs an owner; otherwise questions wait until Monday instead.',
    'Our fictional team removed the recurring Friday meeting.',
  ),
  example(
    'x-filler',
    'x',
    1,
    'Absolutely, so true! In today’s ever-evolving landscape, it is not just about a library but about a valuable perspective on the future. Thank you for sharing!',
    'The invented town plan gives the library a longer opening time.',
  ),
  example(
    'x-sarcasm',
    'x',
    0,
    'Sure, a longer opening time will magically staff the desk by itself. Perhaps the town could budget for another shift before announcing the triumph?',
    'The invented town plan gives the library a longer opening time without adding staff.',
  ),
  example(
    'medium-filler',
    'medium',
    1,
    'Well said, a valuable perspective! In today’s ever-evolving landscape, it is not just about notes but about unlocking potential. Thank you for sharing this great insight.',
    'The fictional article compares handwritten notes with typed notes.',
  ),
  example(
    'medium-specific',
    'medium',
    0,
    'The comparison groups note-taking speed with later recall, but those are different outcomes. Give both groups the same review period before testing what they remember.',
    'The fictional article compares handwritten notes with typed notes.',
  ),
] as const;
