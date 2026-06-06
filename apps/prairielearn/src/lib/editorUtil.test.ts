import { assert, describe, it } from 'vitest';

import { getUniqueNames, propertyValueWithDefault } from './editorUtil.shared.js';

describe('editor utils', () => {
  describe('getNamesForAdd', () => {
    describe('No specified short_name and long_name', () => {
      it('should set short_name to New_1 and long_name to New (1)', () => {
        const names = getUniqueNames({
          shortNames: ['Fa18', 'Fa19'],
          longNames: ['Fall 2018', 'Fall 2019'],
        });
        assert.equal(names.shortName, 'New_1');
        assert.equal(names.longName, 'New (1)');
      });
    });

    describe('Specified unique short_name and long_name', () => {
      it('should use the provided short_name and long_name without appending a number', () => {
        const names = getUniqueNames({
          shortNames: ['Fa18', 'Fa19'],
          longNames: ['Fall 2018', 'Fall 2019'],
          shortName: 'Fa20',
          longName: 'Fall 2020',
        });
        assert.equal(names.shortName, 'Fa20');
        assert.equal(names.longName, 'Fall 2020');
      });
    });

    describe('Duplicated short_name without number, unique long_name', () => {
      it('should append _2 to the short_name and (2) to the long_name', () => {
        const names = getUniqueNames({
          shortNames: ['Fa18', 'Fa19'],
          longNames: ['Fall 2018', 'Fall 2019'],
          shortName: 'Fa19',
          longName: 'Fall 2019 Section 1',
        });
        assert.equal(names.shortName, 'Fa19_2');
        assert.equal(names.longName, 'Fall 2019 Section 1 (2)');
      });
    });

    describe('Duplicated short_name with number, unique long_name', () => {
      it('should increment the number for the short_name and append it to both short_name and long_name', () => {
        const names = getUniqueNames({
          shortNames: ['Fa18', 'Fa19', 'Fa19_2', 'Fa19_3', 'Fa19_4'],
          longNames: [
            'Fall 2018',
            'Fall 2019',
            'Fall 2019 Section 1 (2)',
            'Fall 2019 Section 1 (3)',
            'Fall 2019 Section 1 (4)',
          ],
          shortName: 'Fa19',
          longName: 'Fall 2019 Section 2',
        });

        assert.equal(names.shortName, 'Fa19_5');
        assert.equal(names.longName, 'Fall 2019 Section 2 (5)');
      });
    });

    describe('Unique short_name, duplicated long_name without number', () => {
      it('should leave the unique short_name unchanged and append (2) only to the long_name', () => {
        const names = getUniqueNames({
          shortNames: ['Fa18', 'Fa19'],
          longNames: ['Fall 2018', 'Fall 2019'],
          shortName: 'Fall19',
          longName: 'Fall 2019',
        });

        assert.equal(names.shortName, 'Fall19');
        assert.equal(names.longName, 'Fall 2019 (2)');
      });
    });

    describe('Unique short_name, duplicated long_name with number', () => {
      it('should leave the unique short_name unchanged and increment only the long_name', () => {
        const names = getUniqueNames({
          shortNames: ['Fa18', 'Fa19', 'Fall19_2', 'Fall19_3'],
          longNames: ['Fall 2018', 'Fall 2019', 'Fall 2019 (2)', 'Fall 2019 (3)'],
          shortName: 'Fall_19',
          longName: 'Fall 2019',
        });

        assert.equal(names.shortName, 'Fall_19');
        assert.equal(names.longName, 'Fall 2019 (4)');
      });
    });

    describe('Unique short_name (TID) with a duplicated long_name (title) — issue 14680', () => {
      it('keeps the unique short_name and numbers only the long_name', () => {
        // Creating an assessment whose title duplicates an existing one but whose TID is unique
        // must NOT add a `_n` suffix to the unique TID.
        const names = getUniqueNames({
          shortNames: ['hw1', 'hw2'],
          longNames: ['Homework 1', 'Homework 2'],
          shortName: 'hw3',
          longName: 'Homework 2',
        });

        assert.equal(names.shortName, 'hw3');
        assert.equal(names.longName, 'Homework 2 (2)');
      });
    });

    describe('Duplicated short_name without number, duplicated long_name without number', () => {
      it('should append _2 to the short_name and (2) to the long_name', () => {
        const names = getUniqueNames({
          shortNames: ['Fa18', 'Fa19'],
          longNames: ['Fall 2018', 'Fall 2019'],
          shortName: 'Fa19',
          longName: 'Fall 2019',
        });

        assert.equal(names.shortName, 'Fa19_2');
        assert.equal(names.longName, 'Fall 2019 (2)');
      });
    });

    describe('Duplicated short_name with number, duplicated long_name with number, numbers the same', () => {
      it('should increment both the short_name number and long_name number', () => {
        const names = getUniqueNames({
          shortNames: ['Fa18', 'Fa19', 'Fa19_2', 'Fa19_3'],
          longNames: ['Fall 2018', 'Fall 2019', 'Fall 2019 (2)', 'Fall 2019 (3)'],
          shortName: 'Fa19',
          longName: 'Fall 2019',
        });

        assert.equal(names.shortName, 'Fa19_4');
        assert.equal(names.longName, 'Fall 2019 (4)');
      });
    });

    describe('Duplicated short_name with number, duplicated long_name with number, short_name number > long_name number', () => {
      it('should use the higher number from short_name to generate the next increment', () => {
        const names = getUniqueNames({
          shortNames: ['Fa18', 'Fa19', 'Fa19_2', 'Fa19_3'],
          longNames: ['Fall 2018', 'Fall 2019', 'Fall 2019 (2)', 'Fall 2019 (3)'],
          shortName: 'Fa19',
          longName: 'Fall 2019',
        });

        assert.equal(names.shortName, 'Fa19_4');
        assert.equal(names.longName, 'Fall 2019 (4)');
      });
    });

    describe('Duplicated short_name with number, duplicated long_name with number, short_name number < long_name number', () => {
      it('should use the higher number from long_name to generate the next increment', () => {
        const names = getUniqueNames({
          shortNames: ['Fa18', 'Fa19', 'Fa19_2'],
          longNames: ['Fall 2018', 'Fall 2019', 'Fall 2019 (2)', 'Fall 2019 (3)'],
          shortName: 'Fa19',
          longName: 'Fall 2019',
        });

        assert.equal(names.shortName, 'Fa19_4');
        assert.equal(names.longName, 'Fall 2019 (4)');
      });
    });

    describe('Duplicated short_name without number with different casing, unique long_name', () => {
      it('should append _2 to the short_name and (2) to the long_name', () => {
        const names = getUniqueNames({
          shortNames: ['Fa18', 'Fa19'],
          longNames: ['Fall 2018', 'Fall 2019'],
          shortName: 'fa19',
          longName: 'Fall 2019',
        });

        assert.equal(names.shortName, 'fa19_2');
        assert.equal(names.longName, 'Fall 2019 (2)');
      });
    });

    describe('Duplicated short_name with number with different casing, unique long_name', () => {
      it('should increment the number for the short_name and append it to both short_name and long_name', () => {
        const names = getUniqueNames({
          shortNames: ['Fa18', 'Fa19', 'Fa19_2', 'Fa19_3'],
          longNames: [
            'Fall 2018',
            'Fall 2019',
            'Fall 2019 Section 1 (2)',
            'Fall 2019 Section 1 (3)',
          ],
          shortName: 'fa19',
          longName: 'Fall 2019 Section 2',
        });

        assert.equal(names.shortName, 'fa19_4');
        assert.equal(names.longName, 'Fall 2019 Section 2 (4)');
      });
    });

    describe('Names containing regex special characters', () => {
      it('should escape regex special characters in shortName', () => {
        // Without escaping, "a.b" would incorrectly match "a1b", "a2b", etc.
        const names = getUniqueNames({
          shortNames: ['a1b', 'a2b', 'a.b'],
          longNames: ['Test 1', 'Test 2', 'Test 3'],
          shortName: 'a.b',
          longName: 'Test 4',
        });

        assert.equal(names.shortName, 'a.b_2');
        assert.equal(names.longName, 'Test 4 (2)');
      });

      it('should escape regex special characters in longName', () => {
        // Without escaping, "Calc I + II" creates an invalid regex pattern
        const names = getUniqueNames({
          shortNames: ['CalcI', 'CalcI_2'],
          longNames: ['Calc I + II', 'Calc I + II (2)'],
          shortName: 'CalcII',
          longName: 'Calc I + II',
        });

        // CalcII is unique among the short names, so it stays unchanged (issue 14680);
        // the regex-escaping of "+" is still exercised by the long name counting to (3).
        assert.equal(names.shortName, 'CalcII');
        assert.equal(names.longName, 'Calc I + II (3)');
      });
    });
  });

  describe('propertyValueWithDefault', () => {
    it('should return the new value if it differs from the default value', () => {
      const property = propertyValueWithDefault('Existing', 'New', 'Default');
      assert.equal(property, 'New');
    });
    it('should return undefined if the new value is the same as the default value', () => {
      const property = propertyValueWithDefault('Existing', 'Default', 'Default');
      assert.equal(property, undefined);
    });
    it('should return the new value if it differs from the default value, even if the existing value is undefined', () => {
      const property = propertyValueWithDefault(undefined, 'New', 'Default');
      assert.equal(property, 'New');
    });
    it('should return the new value if it differs from the default value, even if the default value is null', () => {
      const property = propertyValueWithDefault('Existing', null, 'Default');
      assert.equal(property, null);
    });
    it('should return the new value if it differs from the default value, even if the values are numbers', () => {
      const property = propertyValueWithDefault(0, 1, 0);
      assert.equal(property, 1);
    });
    it('should return the new value if it differs from the default value, even if the values are booleans', () => {
      const property = propertyValueWithDefault(true, false, true);
      assert.equal(property, false);
    });
  });
});
